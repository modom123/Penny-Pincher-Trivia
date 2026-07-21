-- Second-opinion AI review (Google Gemini) of Claude-drafted questions.
-- Purely advisory: these columns just attach a verdict/confidence/notes to a
-- pending_review draft so a human can triage faster. promote_question_draft
-- is untouched - a human still has to click Approve regardless of what's
-- recorded here.
alter table public.question_drafts
  add column if not exists ai_review_verdict text,
  add column if not exists ai_review_confidence smallint,
  add column if not exists ai_review_notes text,
  add column if not exists ai_review_model text,
  add column if not exists ai_reviewed_at timestamptz;

alter table public.question_drafts
  drop constraint if exists question_drafts_ai_review_verdict_check;
alter table public.question_drafts
  add constraint question_drafts_ai_review_verdict_check
  check (ai_review_verdict is null or ai_review_verdict in ('agree', 'disagree', 'uncertain'));

alter table public.question_drafts
  drop constraint if exists question_drafts_ai_review_confidence_check;
alter table public.question_drafts
  add constraint question_drafts_ai_review_confidence_check
  check (ai_review_confidence is null or ai_review_confidence between 0 and 100);

create index if not exists question_drafts_needs_ai_review_idx
  on public.question_drafts (created_at)
  where status = 'pending_review' and ai_review_verdict is null;
