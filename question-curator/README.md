# Question Curator Engine

Fills the trivia bank to the design target — **500 questions per subject**, spread as
**25 questions per grade level across 20 levels** — as *reviewable drafts*, never
straight into the live game.

## The model

- **Subjects**: 500 of them (25 domains × 20), defined in [`taxonomy.js`](taxonomy.js)
  and seeded into the `subjects` table.
- **Difficulty = school grade**: 20 levels, one grade per level, starting at **3rd
  grade** and going up a grade each level → `grade_level` **3–22** (3–12 school,
  13–16 college, 17–22 graduate/expert).
- **A 100-round game** spends **5 rounds per grade level** (20 × 5 = 100). Round → grade
  is `round_grade_level(round)` in Postgres (rounds 1–5 → grade 3, …, 96–100 → grade 22).
- **Per subject**: 25 questions at each of the 20 grade levels = **500**. The 25
  candidates per level feed the 5 rounds at that level with randomization/variety.

## Safety model (unchanged)

The engine only ever writes to `question_drafts` with `status = 'pending_review'`.
A human (admin/content_editor) approves each draft via `promote_question_draft` in the
command center before it can appear in a real game. There is no automated
fact-checking pass — **human review is the fact-checking step.** Dedup, shape
validation, and difficulty calibration are automated; truth is not.

## Setup

```bash
cd question-curator
npm install
cp .env.example .env        # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY
```

Apply the migrations first (they create the `subjects` table and seed all 500):

```bash
supabase db push            # applies 20260706190000_subjects_and_curator + 20260706190100_seed_subjects
```

## Run

```bash
npm run smoke                       # 1 subject, dry-run (no writes) — sanity check
node curate.js --subject chess      # one subject
node curate.js --domain "Science & Nature"
node curate.js --all                # the whole bank (long, uses real API budget)
```

Useful flags:

| Flag | Default | Meaning |
|---|---|---|
| `--target N` | 25 | questions per grade level (×20 = per-subject total) |
| `--per-call N` | 10 | questions requested per API call (max 20) |
| `--concurrency N` | 4 | subjects generated in parallel |
| `--dry-run` | off | generate + print, write nothing |
| `--limit-subjects N` | all | only the first N subjects (smoke tests) |

**Idempotent / resumable.** Each run reads current coverage
(`subject_grade_coverage`) and generates only the shortfall — existing approved +
pending drafts count toward the target. Stop and restart a full 250k-question run
anytime; it picks up where it left off. Duplicate questions are blocked both
client-side (content hash) and by a unique index on `(subject_id, content_hash)`.

## Regenerating the taxonomy

Edit [`taxonomy.js`](taxonomy.js), then:

```bash
npm run build:seed          # rewrites subjects.json + the seed migration
supabase db push
```

## Scale & cost note

500 subjects × 500 = **250,000 questions**. That's a large, real API spend and many
hours of generation, plus the review burden — do it incrementally (by domain, or a
handful of launch subjects first). Start narrow, review, then widen. Track progress
per subject with the `subject_curation_status()` RPC (surface it on the command
center's Question Bank page).
