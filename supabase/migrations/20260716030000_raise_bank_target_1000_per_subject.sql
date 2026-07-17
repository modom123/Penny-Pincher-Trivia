-- Raise the per-subject bank target from 500 to 1000 questions (50 per grade level
-- x 20 grade levels). This changes the GOAL the curator fills toward and the
-- denominator on the command center's coverage bars -- it does not create content.
-- Pair with question-curator/curate.js default --target 50.
--
-- Note: 1000 subjects x 1000 questions = 1,000,000 is the stated bank target. The
-- taxonomy still needs to be expanded to 1000 subjects (question-curator/taxonomy.js
-- -> npm run build:seed) for the subject count to follow.

-- Guarded: the subjects/curator layer (migration 20260706190000) may not be applied
-- on every database. If subjects doesn't exist, skip -- there is nothing to retarget.
do $$
begin
  if to_regclass('public.subjects') is not null then
    alter table public.subjects alter column target_question_count set default 1000;
    update public.subjects set target_question_count = 1000 where target_question_count = 500;
  else
    raise notice 'public.subjects not present -- skipping per-subject target bump (apply migration 20260706190000 to enable the subject taxonomy).';
  end if;
end $$;
