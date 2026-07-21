// Automated question drafting: a bounded, resumable batch run of the same
// subject/grade curation model question-curator/curate.js implements
// locally, ported to run as a scheduled edge function so nobody has to run a
// Node script by hand. Every run only ever writes to question_drafts with
// status='pending_review' - a human (admin/content_editor) still approves
// each batch via promote_question_draft in Command Center before anything
// reaches a real game. There is no automated fact-checking pass; human
// review is the fact-checking step (same safety model as generate-questions
// and question-curator/README.md).
//
// Deliberately bounded per invocation (maxSubjects/maxCalls) so a single run
// stays fast and cheap - the cron schedule (see migration
// 20260721050000_schedule_auto_curate.sql) makes cumulative progress by
// calling this repeatedly. Each run only fills the remaining shortfall
// (subject_grade_coverage), so it's safe to run on a schedule indefinitely,
// pause it, or trigger it manually without double-generating.
import { createClient } from "jsr:@supabase/supabase-js@2";

const GRADES = Array.from({ length: 20 }, (_, i) => i + 3); // 3..22

type Subject = { id: string; slug: string; name: string; domain: string };
type Draft = { question_text: string; options: Record<string, string>; correct_option: string };

function gradeDescriptor(g: number): string {
  if (g <= 12) return `a US school student in grade ${g} (${g <= 5 ? "elementary" : g <= 8 ? "middle" : "high"} school)`;
  const map: Record<number, string> = {
    13: "a college freshman",
    14: "a college sophomore",
    15: "a college junior",
    16: "a college senior",
    17: "a master's-degree student",
    18: "an advanced master's student",
    19: "a PhD student",
    20: "a postdoctoral researcher",
    21: "a world-class expert",
    22: "an elite quiz-competition grandmaster",
  };
  return map[g];
}

function validShape(d: unknown): d is Draft {
  const draft = d as Draft;
  return (
    !!draft &&
    typeof draft.question_text === "string" &&
    draft.question_text.trim().length > 0 &&
    !!draft.options &&
    ["A", "B", "C", "D"].every((k) => typeof draft.options[k] === "string" && draft.options[k].trim()) &&
    ["A", "B", "C", "D"].includes(draft.correct_option)
  );
}

async function generateBatch(apiKey: string, model: string, subject: Subject, grade: number, count: number): Promise<Draft[]> {
  const prompt = `Write ${count} multiple-choice trivia questions about "${subject.name}" (domain: ${subject.domain}).
Difficulty: aim them at ${gradeDescriptor(grade)} - grade level ${grade} of 22, where 3 is easiest and 22 is hardest. Calibrate difficulty carefully to that level.

Rules:
- Exactly four options A/B/C/D, exactly one unambiguously correct.
- Distractors must be plausible and clearly wrong to someone who knows the answer - no "All of the above", no trick joke options.
- Factually accurate and verifiable. Self-contained (no "as shown above").
- No duplicates within this set; vary the sub-topics.

Return ONLY a JSON array, no prose. Each item exactly:
{"question_text": string, "options": {"A": string, "B": string, "C": string, "D": string}, "correct_option": "A"|"B"|"C"|"D"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const raw: string = json.content?.[0]?.text ?? "";
  let parsed: unknown;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(validShape) : [];
}

Deno.serve(async (req: Request) => {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Question generation is not configured (missing ANTHROPIC_API_KEY)." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Two ways in: the scheduled cron job (shared secret header, no user
  // session exists) or a staff member clicking "Run now" in Command Center
  // (their own session, checked the same way generate-questions does).
  const cronSecret = Deno.env.get("CURATOR_CRON_SECRET");
  const providedSecret = req.headers.get("x-cron-secret");
  const isCron = !!cronSecret && providedSecret === cronSecret;

  if (!isCron) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: isStaff, error: staffError } = await userClient.rpc("is_staff", {
      required_roles: ["admin", "content_editor"],
    });
    if (staffError || !isStaff) {
      return new Response(JSON.stringify({ error: "Forbidden: staff access required" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  let body: { maxSubjects?: number; targetPerGrade?: number; perCall?: number; maxCalls?: number; ignoreBudget?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine (the cron job sends one) - use defaults.
  }
  const maxSubjects = Math.min(Math.max(body.maxSubjects ?? 5, 1), 20);
  const targetPerGrade = Math.min(Math.max(body.targetPerGrade ?? 5, 1), 50);
  const perCall = Math.min(Math.max(body.perCall ?? 10, 1), 20);
  const requestedMaxCalls = Math.min(Math.max(body.maxCalls ?? 8, 1), 20);
  const model = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5-20250929";

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The automatic schedule is always funded by real tournament revenue (see
  // fund_content_budget_on_completion) - it never spends more than the house
  // has actually earned toward content generation. A staff member running
  // this manually can consciously override that with ignoreBudget=true (e.g.
  // to seed a brand-new topic before any tournament has funded it yet); the
  // cron path can never set this, regardless of what's in its request body.
  const ignoreBudget = !isCron && body.ignoreBudget === true;
  let maxCalls = requestedMaxCalls;
  let budgetCentsAtStart = 0;
  let estCostCentsPerCall = 10;

  if (!ignoreBudget) {
    const { data: budgetRow } = await admin.from("platform_config").select("value").eq("key", "content_budget_cents").maybeSingle();
    const { data: costRow } = await admin
      .from("platform_config")
      .select("value")
      .eq("key", "content_budget_est_cost_cents_per_call")
      .maybeSingle();
    budgetCentsAtStart = Number(budgetRow?.value ?? 0);
    estCostCentsPerCall = Math.max(Number(costRow?.value ?? 10), 1);
    const affordableCalls = Math.floor(budgetCentsAtStart / estCostCentsPerCall);
    maxCalls = Math.min(requestedMaxCalls, affordableCalls);

    if (maxCalls <= 0) {
      return new Response(
        JSON.stringify({
          subjectsProcessed: 0,
          callsMade: 0,
          drafted: 0,
          perSubjectResults: [],
          errors: [],
          skippedReason: `No content budget available (balance ${budgetCentsAtStart}c, needs ${estCostCentsPerCall}c/call). Waiting for a completed tournament to fund it, or run manually with ignoreBudget.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  const { data: candidateSubjects, error: subjErr } = await admin
    .from("subjects")
    .select("id, slug, name, domain")
    .eq("is_active", true)
    .order("sort_order")
    .limit(300); // wide pool; already-covered subjects are skipped below without counting against maxSubjects

  if (subjErr) {
    return new Response(JSON.stringify({ error: subjErr.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let callsMade = 0;
  let drafted = 0;
  let subjectsProcessed = 0;
  const perSubjectResults: Array<{ slug: string; drafted: number }> = [];
  const errors: string[] = [];

  for (const subject of (candidateSubjects ?? []) as Subject[]) {
    if (subjectsProcessed >= maxSubjects || callsMade >= maxCalls) break;

    const { data: coverage, error: covErr } = await admin.rpc("subject_grade_coverage", { p_subject_id: subject.id });
    if (covErr || !coverage) continue;
    const have: Record<number, number> = {};
    for (const c of coverage as { grade_level: number; approved_count: number; pending_count: number }[]) {
      have[c.grade_level] = Number(c.approved_count) + Number(c.pending_count);
    }
    const shortfallGrades = GRADES.filter((g) => (have[g] || 0) < targetPerGrade);
    if (shortfallGrades.length === 0) continue; // fully covered at this target - skip without spending budget

    let subjectDrafted = 0;
    for (const grade of shortfallGrades) {
      if (callsMade >= maxCalls) break;
      const need = Math.min(targetPerGrade - (have[grade] || 0), perCall);
      callsMade++;
      let batch: Draft[];
      try {
        batch = await generateBatch(apiKey, model, subject, grade, need);
      } catch (e) {
        errors.push(`${subject.slug} g${grade}: ${(e as Error).message}`);
        continue;
      }
      if (batch.length === 0) continue;

      const rows = batch.map((q) => ({
        question_text: q.question_text.trim(),
        options: q.options,
        correct_option: q.correct_option,
        difficulty_level: grade,
        grade_level: grade,
        category: subject.name,
        subject_id: subject.id,
        generated_by: "ai",
        status: "pending_review",
      }));

      const { error: insertErr } = await admin.from("question_drafts").insert(rows);
      if (!insertErr) {
        subjectDrafted += rows.length;
      } else {
        // Duplicate content_hash (subject_id, content_hash unique index) drops the
        // whole batch on a bulk insert - fall back row-by-row so one dup doesn't
        // cost the rest.
        for (const row of rows) {
          const { error: rowErr } = await admin.from("question_drafts").insert(row);
          if (!rowErr) subjectDrafted++;
        }
      }
    }

    if (subjectDrafted > 0) {
      drafted += subjectDrafted;
      perSubjectResults.push({ slug: subject.slug, drafted: subjectDrafted });
    }
    subjectsProcessed++;
  }

  let budgetCentsRemaining: number | null = null;
  if (!ignoreBudget && callsMade > 0) {
    const { data: newBalance } = await admin.rpc("debit_content_budget", { p_cents: callsMade * estCostCentsPerCall });
    budgetCentsRemaining = typeof newBalance === "number" ? newBalance : null;
  }

  return new Response(
    JSON.stringify({ subjectsProcessed, callsMade, drafted, perSubjectResults, errors, budgetCentsRemaining }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
