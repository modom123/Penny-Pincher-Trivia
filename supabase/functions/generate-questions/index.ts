// "Trivia Alchemist": drafts trivia questions via an LLM for staff review.
// Unlike the fully-autonomous design this is modeled on, nothing here ever
// touches the live `questions` table directly - every draft lands in
// `question_drafts` with status 'pending_review' and needs a human
// (admin/content_editor) to approve it via promote_question_draft() before
// it can appear in a real game. There is no automated fact-checking pass -
// that would need a separate knowledge-base/search integration this build
// doesn't have - so human review is the actual safety mechanism here.
import { createClient } from "jsr:@supabase/supabase-js@2";

type DraftRequest = {
  category?: string;
  roundStart: number;
  roundEnd: number;
};

Deno.serve(async (req: Request) => {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Question generation is not configured (missing ANTHROPIC_API_KEY)." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  let body: DraftRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const { category, roundStart, roundEnd } = body;
  if (!Number.isInteger(roundStart) || !Number.isInteger(roundEnd) || roundStart < 1 || roundEnd > 100 || roundStart > roundEnd) {
    return new Response(JSON.stringify({ error: "roundStart/roundEnd must be a valid 1-100 range" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (roundEnd - roundStart > 24) {
    return new Response(JSON.stringify({ error: "Request at most 25 rounds at a time" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const prompt = `Generate ${roundEnd - roundStart + 1} multiple-choice trivia questions${
    category ? ` in the category "${category}"` : ""
  }, one for each difficulty_level from ${roundStart} to ${roundEnd} inclusive (difficulty scales with the number - higher numbers should be noticeably harder). Return ONLY a JSON array, no prose, where each item has exactly this shape:
{"question_text": string, "options": {"A": string, "B": string, "C": string, "D": string}, "correct_option": "A"|"B"|"C"|"D", "difficulty_level": number, "category": string}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return new Response(JSON.stringify({ error: `LLM request failed: ${response.status} ${text}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const completion = await response.json();
  const rawText: string = completion.content?.[0]?.text ?? "";

  let drafts: Array<{
    question_text: string;
    options: Record<string, string>;
    correct_option: string;
    difficulty_level: number;
    category?: string;
  }>;
  try {
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    drafts = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    return new Response(JSON.stringify({ error: "Could not parse LLM output as JSON", raw: rawText }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const valid = drafts.filter(
    (d) =>
      typeof d.question_text === "string" &&
      d.options &&
      ["A", "B", "C", "D"].every((k) => typeof d.options[k] === "string") &&
      ["A", "B", "C", "D"].includes(d.correct_option) &&
      Number.isInteger(d.difficulty_level)
  );

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: inserted, error: insertError } = await admin
    .from("question_drafts")
    .insert(
      valid.map((d) => ({
        question_text: d.question_text,
        options: d.options,
        correct_option: d.correct_option,
        difficulty_level: d.difficulty_level,
        category: d.category ?? category ?? null,
        generated_by: "ai",
        status: "pending_review",
      }))
    )
    .select();

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ drafted: inserted.length, skipped: drafts.length - valid.length, drafts: inserted }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
});
