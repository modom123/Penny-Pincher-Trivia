-- Per-contest model: a tournament only needs 100 questions (5 per grade level x
-- 20 levels), generated on demand and published - no need to pre-build all 250k.
--
-- This tightens create_game_for_subject so each 100-round game uses 5 DISTINCT
-- questions per grade level (no repeats within a game). It therefore requires at
-- least 5 approved questions at every grade 3..22 for the subject - exactly the
-- 100 the per-contest generator produces.
create or replace function public.create_game_for_subject(p_subject_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_short int;
begin
  if not exists (select 1 from public.subjects where id = p_subject_id and is_active) then
    raise exception 'Subject % not found or inactive', p_subject_id;
  end if;

  -- Need >= 5 approved questions at each of the 20 grade levels (5 rounds/level).
  select count(*) into v_short
  from generate_series(3, 22) g
  where (select count(*) from public.questions
         where subject_id = p_subject_id and grade_level = g) < 5;
  if v_short > 0 then
    raise exception
      'Subject not ready: % grade level(s) have fewer than 5 approved questions', v_short;
  end if;

  insert into public.games (mode) values ('original_escalator') returning * into v_game;

  -- Assign 5 distinct random questions per grade to that grade's 5 rounds.
  -- round -> grade via round_grade_level(); slot 1..5 is the round's position
  -- within its grade tier; we join slot to a per-grade random ranking (rn 1..5).
  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  with rounds as (
    select r as round_number,
           public.round_grade_level(r) as grade,
           ((r - 1) % 5) + 1 as slot
    from generate_series(1, 100) r
  ),
  ranked_q as (
    select grade_level, question_id,
           row_number() over (partition by grade_level order by random()) as rn
    from public.questions
    where subject_id = p_subject_id and grade_level between 3 and 22
  )
  select v_game.game_id, rd.round_number, rq.question_id, rd.round_number
  from rounds rd
  join ranked_q rq on rq.grade_level = rd.grade and rq.rn = rd.slot;

  return v_game;
end;
$$;
revoke execute on function public.create_game_for_subject(uuid) from public, anon, authenticated;
grant execute on function public.create_game_for_subject(uuid) to service_role;
