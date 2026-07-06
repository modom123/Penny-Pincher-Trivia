-- Placeholder trivia content, one per round (difficulty_level 1..100).
-- Replace with real licensed/curated trivia before launch.
insert into public.questions (question_text, options, correct_option, difficulty_level, category, time_limit_seconds)
select
  format('[Round %s] Sample %s question #%s - replace with real content.', r, cat.name, r),
  jsonb_build_object(
    'A', format('Option A for round %s', r),
    'B', format('Option B for round %s', r),
    'C', format('Option C for round %s', r),
    'D', format('Option D for round %s', r)
  ),
  (array['A','B','C','D'])[(r % 4) + 1],
  r,
  cat.name,
  12
from generate_series(1, 100) r
cross join lateral (
  select (array['General Knowledge','Science','History','Geography','Pop Culture','Sports','Movies','Music'])[(r % 8) + 1] as name
) cat;
