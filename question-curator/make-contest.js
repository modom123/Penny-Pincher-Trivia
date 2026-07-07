#!/usr/bin/env node
// Penny Pincher Trivia — Per-Contest Generator
//
// The lean path: a tournament only needs 100 questions (5 per grade level x 20
// levels). This generates just those on demand and publishes a new tournament -
// no need to pre-build all 250k. The bank fills lazily, one contest at a time.
//
// Flow:
//   1. Generate `per-grade` (default 5) questions for each grade 3..22 for a subject.
//   2. Insert them (LIVE by default, or as drafts with --draft), deduped.
//   3. Publish: create a 100-round tournament wired to that subject
//      (create_game_for_subject picks 5 distinct questions per grade).
//
// Usage:
//   node make-contest.js --subject ancient-egypt            # generate 100 + publish
//   node make-contest.js --subject chess --draft            # generate to review queue, don't publish
//   node make-contest.js --subject chess --reuse            # publish from existing bank, no API spend
//   node make-contest.js --subject chess --dry-run          # generate + preview, write nothing
//
// SAFETY: without --draft this puts AI-written questions straight into a
// real-money contest with NO human fact-check. For anything with real money on
// the line, use --draft, approve in the command center, then --reuse to publish.
require("dotenv").config();
const lib = require("./lib");

const args = lib.parseArgs(process.argv.slice(2));
const SLUG = args.subject;
const PER_GRADE = lib.int(args["per-grade"], 5);
const DRAFT = !!args.draft;
const REUSE = !!args.reuse;
const DRY_RUN = !!args["dry-run"];
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const { ANTHROPIC_API_KEY } = process.env;

if (!SLUG) fail("--subject <slug> is required. See subjects.json for slugs.");
if (!ANTHROPIC_API_KEY && !REUSE && !DRY_RUN) fail("Missing ANTHROPIC_API_KEY (or use --reuse / --dry-run).");
if (PER_GRADE < 5 && !REUSE) console.warn("Note: <5 per grade won't be enough to publish a 100-round game on its own.");

(async () => {
  const db = lib.makeDb();

  const { data: subject, error: sErr } = await db
    .from("subjects").select("id, slug, name, domain").eq("slug", SLUG).single();
  if (sErr || !subject) fail(`Subject "${SLUG}" not found. Did you run the seed migration?`);

  if (!REUSE) {
    const table = DRAFT ? "question_drafts" : "questions";
    const seen = await lib.loadSeenHashes(db, subject.id);
    let inserted = 0;

    for (const grade of lib.GRADES) {
      const batch = await lib.generateBatch({ apiKey: ANTHROPIC_API_KEY, model: MODEL, subject, grade, count: PER_GRADE });
      const fresh = [];
      for (const q of batch) {
        const h = lib.contentHash(q.question_text);
        if (seen.has(h)) continue;
        seen.add(h);
        const s = lib.shuffleOptions(q); // balance the correct-answer position
        const row = {
          question_text: q.question_text.trim(),
          options: s.options,
          correct_option: s.correct_option,
          difficulty_level: grade, // legacy column, kept in valid 1..100 range
          grade_level: grade,
          category: subject.name,
          subject_id: subject.id,
          time_limit_seconds: 12,
        };
        if (DRAFT) { row.generated_by = "ai"; row.status = "pending_review"; }
        fresh.push(row);
      }

      if (DRY_RUN) { console.log(`  [dry-run] g${grade}: +${fresh.length}`); continue; }
      if (fresh.length) {
        const { error } = await db.from(table).insert(fresh);
        if (error) console.warn(`  ! g${grade} insert: ${error.message}`);
        else inserted += fresh.length;
      }
    }

    console.log(`Generated ${inserted} question(s) for "${subject.name}" into ${table}.`);
    if (DRY_RUN) return;
    if (DRAFT) {
      console.log("\nDrafts are pending review. Approve them in the command center (Question Bank),");
      console.log(`then publish with:  node make-contest.js --subject ${SLUG} --reuse`);
      return;
    }
  }

  // Publish the tournament.
  const { data: game, error: gErr } = await db.rpc("create_game_for_subject", { p_subject_id: subject.id });
  if (gErr) fail(`Could not publish tournament: ${gErr.message}`);
  const g = Array.isArray(game) ? game[0] : game;
  console.log(`\n✅ Tournament published: game_id ${g.game_id} (status ${g.status}, ${g.total_rounds} rounds).`);
  console.log("   The game-engine --watch worker will pick it up and run it.");
  if (!DRAFT) console.log("   ⚠  Questions were published WITHOUT human review. Use --draft for real-money contests.");
})();

function fail(msg) { console.error("Error: " + msg); process.exit(1); }
