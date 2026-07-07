#!/usr/bin/env node
// Penny Pincher Trivia — Bulk Curator Engine
//
// Pre-fills the question bank toward 500 questions/subject (25 per grade level x
// 20 grades) as reviewable DRAFTS. Optional: for launch you usually don't need
// this — use make-contest.js to generate 100 questions per tournament on demand.
// Use this only when you want a deep pre-built bank for a set of subjects.
//
// Writes DRAFTS only (question_drafts, pending_review). A human approves each via
// promote_question_draft — that review is the fact-checking step.
//
// Idempotent/resumable: re-running only fills gaps (approved + pending count
// toward the target).
//
// Usage:
//   node curate.js --all
//   node curate.js --subject ancient-egypt
//   node curate.js --domain "Science & Nature" --target 25 --concurrency 4
//   node curate.js --all --limit-subjects 3 --dry-run
require("dotenv").config();
const lib = require("./lib");

const args = lib.parseArgs(process.argv.slice(2));
const TARGET_PER_GRADE = lib.int(args.target, 25);
const PER_CALL = Math.min(lib.int(args["per-call"], 10), 20);
const CONCURRENCY = lib.int(args.concurrency, 4);
const DRY_RUN = !!args["dry-run"];
const LIMIT_SUBJECTS = args["limit-subjects"] ? lib.int(args["limit-subjects"], 0) : 0;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const { ANTHROPIC_API_KEY } = process.env;

if (!ANTHROPIC_API_KEY && !DRY_RUN) fail("Missing ANTHROPIC_API_KEY (see .env.example). Use --dry-run to test without it.");

const db = lib.makeDb();
const DIST = { A: 0, B: 0, C: 0, D: 0 }; // correct-answer position distribution (should be ~even)

async function curateSubject(subject) {
  const seen = await lib.loadSeenHashes(db, subject.id);

  const { data: coverage, error: covErr } = await db.rpc("subject_grade_coverage", { p_subject_id: subject.id });
  if (covErr) throw new Error(`coverage: ${covErr.message}`);
  const have = Object.fromEntries(coverage.map((c) => [c.grade_level, Number(c.approved_count) + Number(c.pending_count)]));

  let drafted = 0, skipped = 0;
  for (const grade of lib.GRADES) {
    let need = TARGET_PER_GRADE - (have[grade] || 0);
    while (need > 0) {
      const batch = await lib.generateBatch({
        apiKey: ANTHROPIC_API_KEY, model: MODEL, subject, grade, count: Math.min(need, PER_CALL),
      });
      const fresh = [];
      for (const q of batch) {
        const h = lib.contentHash(q.question_text);
        if (seen.has(h)) { skipped++; continue; }
        seen.add(h);
        const s = lib.shuffleOptions(q); // balance the correct-answer position
        DIST[s.correct_option]++;
        fresh.push({
          question_text: q.question_text.trim(),
          options: s.options,
          correct_option: s.correct_option,
          difficulty_level: grade,
          grade_level: grade,
          category: subject.name,
          subject_id: subject.id,
          generated_by: "ai",
          status: "pending_review",
        });
      }
      if (fresh.length === 0) break; // nothing new; avoid infinite loop
      if (DRY_RUN) console.log(`  [dry-run] ${subject.slug} g${grade}: +${fresh.length}`);
      else drafted += await insertDrafts(fresh);
      need -= fresh.length;
    }
  }
  return { drafted, skipped };
}

async function insertDrafts(rows) {
  const { error } = await db.from("question_drafts").insert(rows);
  if (!error) return rows.length;
  let ok = 0; // fall back row-by-row on a duplicate/constraint race
  for (const r of rows) {
    const { error: e } = await db.from("question_drafts").insert(r);
    if (!e) ok++;
    else if (!/duplicate key|unique/i.test(e.message)) console.warn(`  ! insert: ${e.message}`);
  }
  return ok;
}

(async () => {
  let subjects = await loadSubjects();
  if (LIMIT_SUBJECTS) subjects = subjects.slice(0, LIMIT_SUBJECTS);
  if (subjects.length === 0) fail("No matching subjects. Did you run the seed migration?");

  console.log(
    `Curating ${subjects.length} subject(s) · target ${TARGET_PER_GRADE}/grade × 20 grades ` +
    `= ${TARGET_PER_GRADE * 20}/subject · model ${MODEL}${DRY_RUN ? " · DRY RUN" : ""}`
  );

  let total = 0;
  await runPool(subjects, CONCURRENCY, async (subject, i) => {
    try {
      const { drafted, skipped } = await curateSubject(subject);
      total += drafted;
      console.log(`[${i + 1}/${subjects.length}] ${subject.slug}: +${drafted} drafted, ${skipped} dup-skipped`);
    } catch (e) {
      console.error(`[${i + 1}/${subjects.length}] ${subject.slug}: ERROR ${e.message}`);
    }
  });
  console.log(`\nDone. ${total} draft(s) written to question_drafts (pending review).`);
  console.log(`Correct-answer distribution: A=${DIST.A} B=${DIST.B} C=${DIST.C} D=${DIST.D} (balanced by shuffle).`);
})();

async function loadSubjects() {
  let q = db.from("subjects").select("id, slug, name, domain").eq("is_active", true).order("sort_order");
  if (args.subject) q = q.eq("slug", args.subject);
  if (args.domain) q = q.eq("domain", args.domain);
  const { data, error } = await q;
  if (error) fail(`Could not load subjects: ${error.message}`);
  return data;
}

async function runPool(items, size, worker) {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await worker(items[i], i); }
  }));
}

function fail(msg) { console.error("Error: " + msg); process.exit(1); }
