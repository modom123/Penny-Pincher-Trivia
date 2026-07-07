#!/usr/bin/env node
// Penny Pincher Trivia — Question Curator Engine
//
// Fills the question bank against the design target of 500 questions per subject
// = 25 per grade level (grades 3..22) across 20 levels. For each subject/grade it
// checks current coverage, generates only the shortfall via the Anthropic API,
// validates + dedups, and writes DRAFTS to `question_drafts` (status
// pending_review). Nothing here ever touches the live `questions` table — a human
// (admin/content_editor) still approves each draft via promote_question_draft in
// the command center. That human review is the fact-checking safety net.
//
// Idempotent / resumable: re-running only fills gaps (existing approved+pending
// count toward the target), so you can stop and restart a 250k-question run.
//
// Usage:
//   node curate.js --all                 # every active subject
//   node curate.js --subject ancient-egypt
//   node curate.js --domain "Science & Nature"
//   node curate.js --all --target 25 --per-call 10 --concurrency 4
//   node curate.js --subject chess --dry-run   # generate + print, no DB writes
//   node curate.js --all --limit-subjects 3    # smoke test on 3 subjects
require("dotenv").config();
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

// ---------- config ----------
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-sonnet-5",
} = process.env;

const args = parseArgs(process.argv.slice(2));
const TARGET_PER_GRADE = int(args.target, 25);
const PER_CALL = Math.min(int(args["per-call"], 10), 20);
const CONCURRENCY = int(args.concurrency, 4);
const DRY_RUN = !!args["dry-run"];
const LIMIT_SUBJECTS = args["limit-subjects"] ? int(args["limit-subjects"], 0) : 0;
const GRADES = range(3, 22);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  fail("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
}
if (!ANTHROPIC_API_KEY && !DRY_RUN) {
  fail("Missing ANTHROPIC_API_KEY (see .env.example). Use --dry-run to test without it.");
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------- grade -> human difficulty descriptor ----------
function gradeDescriptor(g) {
  if (g <= 12) return `a US school student in grade ${g} (${g <= 5 ? "elementary" : g <= 8 ? "middle" : "high"} school)`;
  const map = {
    13: "a college freshman", 14: "a college sophomore", 15: "a college junior",
    16: "a college senior", 17: "a master's-degree student", 18: "an advanced master's student",
    19: "a PhD student", 20: "a postdoctoral researcher", 21: "a world-class expert",
    22: "an elite quiz-competition grandmaster",
  };
  return map[g];
}

// ---------- Anthropic ----------
async function generateBatch(subject, grade, count) {
  const prompt =
`Write ${count} multiple-choice trivia questions about "${subject.name}" (domain: ${subject.domain}).
Difficulty: aim them at ${gradeDescriptor(grade)} — grade level ${grade} of 22, where 3 is easiest and 22 is hardest. Calibrate difficulty carefully to that level.

Rules:
- Exactly four options A/B/C/D, exactly one unambiguously correct.
- Distractors must be plausible and clearly wrong to someone who knows the answer — no "All of the above", no trick joke options.
- Factually accurate and verifiable. Self-contained (no "as shown above").
- No duplicates within this set; vary the sub-topics.

Return ONLY a JSON array, no prose. Each item exactly:
{"question_text": string, "options": {"A": string, "B": string, "C": string, "D": string}, "correct_option": "A"|"B"|"C"|"D"}`;

  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const json = await res.json();
  const raw = json.content?.[0]?.text ?? "";
  let parsed;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    console.warn(`  ! could not parse model output for ${subject.slug} grade ${grade}`);
    return [];
  }
  return Array.isArray(parsed) ? parsed.filter(validShape) : [];
}

function validShape(d) {
  return (
    d && typeof d.question_text === "string" && d.question_text.trim().length > 0 &&
    d.options && ["A", "B", "C", "D"].every((k) => typeof d.options[k] === "string" && d.options[k].trim()) &&
    ["A", "B", "C", "D"].includes(d.correct_option)
  );
}

// content_hash must match the DB generated column: md5(lower(btrim(text)))
const contentHash = (text) => crypto.createHash("md5").update(text.toLowerCase().trim()).digest("hex");

// ---------- per-subject curation ----------
async function curateSubject(subject) {
  // Load existing hashes for this subject (drafts + live) so we never re-draft.
  const seen = new Set();
  for (const table of ["question_drafts", "questions"]) {
    const { data, error } = await db.from(table).select("question_text").eq("subject_id", subject.id);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) seen.add(contentHash(r.question_text));
  }

  const { data: coverage, error: covErr } = await db.rpc("subject_grade_coverage", { p_subject_id: subject.id });
  if (covErr) throw new Error(`coverage: ${covErr.message}`);
  const have = Object.fromEntries(coverage.map((c) => [c.grade_level, Number(c.approved_count) + Number(c.pending_count)]));

  let drafted = 0, skipped = 0;
  for (const grade of GRADES) {
    let need = TARGET_PER_GRADE - (have[grade] || 0);
    if (need <= 0) continue;

    while (need > 0) {
      const ask = Math.min(need, PER_CALL);
      const batch = await generateBatch(subject, grade, ask);
      const fresh = [];
      for (const q of batch) {
        const h = contentHash(q.question_text);
        if (seen.has(h)) { skipped++; continue; }
        seen.add(h);
        fresh.push({
          question_text: q.question_text.trim(),
          options: q.options,
          correct_option: q.correct_option,
          difficulty_level: grade,       // legacy column (kept in valid 1..100 range)
          grade_level: grade,            // the real difficulty dimension
          category: subject.name,
          subject_id: subject.id,
          generated_by: "ai",
          status: "pending_review",
        });
      }
      if (fresh.length === 0) break; // model returned nothing new; avoid infinite loop

      if (DRY_RUN) {
        console.log(`  [dry-run] ${subject.slug} g${grade}: +${fresh.length}`);
      } else {
        const inserted = await insertDrafts(fresh);
        drafted += inserted;
      }
      need -= fresh.length;
    }
  }
  return { drafted, skipped };
}

async function insertDrafts(rows) {
  const { error } = await db.from("question_drafts").insert(rows);
  if (!error) return rows.length;
  // Fall back to row-by-row on a duplicate/constraint race so one bad row
  // doesn't drop a whole batch.
  let ok = 0;
  for (const r of rows) {
    const { error: e } = await db.from("question_drafts").insert(r);
    if (!e) ok++;
    else if (!/duplicate key|unique/i.test(e.message)) console.warn(`  ! insert: ${e.message}`);
  }
  return ok;
}

// ---------- main ----------
(async () => {
  let subjects = await loadSubjects();
  if (LIMIT_SUBJECTS) subjects = subjects.slice(0, LIMIT_SUBJECTS);
  if (subjects.length === 0) fail("No matching subjects. Did you run the seed migration?");

  console.log(
    `Curating ${subjects.length} subject(s) · target ${TARGET_PER_GRADE}/grade × 20 grades ` +
    `= ${TARGET_PER_GRADE * 20}/subject · model ${ANTHROPIC_MODEL}${DRY_RUN ? " · DRY RUN" : ""}`
  );

  let totalDrafted = 0;
  await runPool(subjects, CONCURRENCY, async (subject, i) => {
    try {
      const { drafted, skipped } = await curateSubject(subject);
      totalDrafted += drafted;
      console.log(`[${i + 1}/${subjects.length}] ${subject.slug}: +${drafted} drafted, ${skipped} dup-skipped`);
    } catch (e) {
      console.error(`[${i + 1}/${subjects.length}] ${subject.slug}: ERROR ${e.message}`);
    }
  });

  console.log(`\nDone. ${totalDrafted} draft(s) written to question_drafts (pending review).`);
})();

// ---------- helpers ----------
async function loadSubjects() {
  let q = db.from("subjects").select("id, slug, name, domain").eq("is_active", true).order("sort_order");
  if (args.subject) q = q.eq("slug", args.subject);
  if (args.domain) q = q.eq("domain", args.domain);
  const { data, error } = await q;
  if (error) fail(`Could not load subjects: ${error.message}`);
  return data;
}

async function fetchWithRetry(url, opts, attempt = 1) {
  const res = await fetch(url, opts);
  if (res.ok) return res;
  if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt <= 5) {
    const wait = Math.min(2 ** attempt, 30) * 1000;
    console.warn(`  · API ${res.status}; backing off ${wait / 1000}s (attempt ${attempt})`);
    await sleep(wait);
    return fetchWithRetry(url, opts, attempt + 1);
  }
  throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function runPool(items, size, worker) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(workers);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(msg) { console.error("Error: " + msg); process.exit(1); }
