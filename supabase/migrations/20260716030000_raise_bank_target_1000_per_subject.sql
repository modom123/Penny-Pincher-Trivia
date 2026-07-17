-- Raise the per-subject bank target from 500 to 1000 questions (50 per grade level
-- x 20 grade levels). This changes the GOAL the curator fills toward and the
-- denominator on the command center's coverage bars -- it does not create content.
-- Pair with question-curator/curate.js default --target 50.
--
-- Note: 1000 subjects x 1000 questions = 1,000,000 is the stated bank target. The
-- taxonomy still needs to be expanded to 1000 subjects (question-curator/taxonomy.js
-- -> npm run build:seed) for the subject count to follow.

alter table public.subjects alter column target_question_count set default 1000;
update public.subjects set target_question_count = 1000 where target_question_count = 500;
