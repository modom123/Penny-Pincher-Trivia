// Shared generation helpers for the curator (bulk) and make-contest (per-tournament) tools.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const GRADES = Array.from({ length: 20 }, (_, i) => i + 3); // 3..22

function requireEnv() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Error: Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see .env.example).");
    process.exit(1);
  }
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}

function makeDb() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requireEnv();
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

// grade_level 3..22 -> a human difficulty descriptor for the prompt.
function gradeDescriptor(g) {
  if (g <= 12) return `a US school student in grade ${g} (${g <= 5 ? "elementary" : g <= 8 ? "middle" : "high"} school)`;
  return {
    13: "a college freshman", 14: "a college sophomore", 15: "a college junior",
    16: "a college senior", 17: "a master's-degree student", 18: "an advanced master's student",
    19: "a PhD student", 20: "a postdoctoral researcher", 21: "a world-class expert",
    22: "an elite quiz-competition grandmaster",
  }[g];
}

// content_hash must match the DB generated column: md5(lower(btrim(text))).
const contentHash = (text) => crypto.createHash("md5").update(text.toLowerCase().trim()).digest("hex");

function validShape(d) {
  return (
    d && typeof d.question_text === "string" && d.question_text.trim().length > 0 &&
    d.options && ["A", "B", "C", "D"].every((k) => typeof d.options[k] === "string" && d.options[k].trim()) &&
    ["A", "B", "C", "D"].includes(d.correct_option)
  );
}

async function generateBatch({ apiKey, model, subject, grade, count }) {
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
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
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

// Load existing content hashes for a subject (drafts + live) so we never repeat.
async function loadSeenHashes(db, subjectId) {
  const seen = new Set();
  for (const table of ["question_drafts", "questions"]) {
    const { data, error } = await db.from(table).select("question_text").eq("subject_id", subjectId);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of data) seen.add(contentHash(r.question_text));
  }
  return seen;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  GRADES, makeDb, gradeDescriptor, contentHash, validShape, generateBatch,
  fetchWithRetry, loadSeenHashes, parseArgs, int, sleep,
};
