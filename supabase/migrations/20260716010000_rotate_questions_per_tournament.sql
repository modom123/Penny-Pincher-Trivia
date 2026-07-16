-- Make each tournament draw DIFFERENT questions instead of the same fixed 100.
--
-- Before: create_game filled each round with `distinct on (difficulty_level) ...
-- order by difficulty_level, random()`. With one question per difficulty_level in
-- the bank, random() has nothing to choose from, so every game served the identical
-- 100 questions. Even with a few per level, plain random() collides often and can
-- repeat the same question in back-to-back tournaments.
--
-- After: per level we pick the LEAST-RECENTLY-USED question -- the one assigned to
-- the fewest prior games -- breaking ties randomly. This deterministically rotates
-- through the whole bank: a question won't be reused until every other question at
-- its level has been used at least as many times. So with N questions at a level,
-- N consecutive tournaments are fully distinct at that level before anything repeats,
-- and repeats always fall on the oldest-used question.
--
-- REQUIREMENT: uniqueness scales with bank depth. With only 1 question at a level
-- that level is unavoidably identical every game -- deepen the bank (more rows per
-- difficulty_level, via authoring or the reviewed Trivia Alchemist pipeline) to widen
-- the rotation window. This function makes the rotation correct for whatever depth
-- exists; it does not manufacture depth.
--
-- Body is otherwise a faithful copy of create_game from 20260713040000 (draft status,
-- per-mode round cost, missing-level guard).

-- Keep the least-used lookup fast as game history grows (FK columns aren't auto-indexed).
create index if not exists idx_game_rounds_question on public.game_rounds(question_id);

create or replace function public.create_game(p_mode public.game_mode default 'original_escalator')
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_missing int[];
begin
  insert into public.games (status, current_round, total_rounds, mode)
  values ('draft', 0, 100, p_mode) returning * into v_game;

  select array_agg(r) into v_missing
  from generate_series(1, 100) r
  where not exists (select 1 from public.questions q where q.difficulty_level = r);
  if v_missing is not null then
    raise exception 'No question bank entries for rounds: %', v_missing;
  end if;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  select
    v_game.game_id, q.difficulty_level, q.question_id,
    case p_mode
      when 'milestone_booster' then
        case
          when q.difficulty_level <= 25 then 10
          when q.difficulty_level <= 50 then 25
          when q.difficulty_level <= 75 then 50
          else 100
        end
      else q.difficulty_level
    end
  from (
    -- Least-recently-used per level: fewest prior game assignments first, then random.
    select distinct on (qq.difficulty_level) qq.difficulty_level, qq.question_id
    from public.questions qq
    left join (
      select question_id, count(*)::int as uses
      from public.game_rounds
      group by question_id
    ) u on u.question_id = qq.question_id
    where qq.difficulty_level between 1 and 100
    order by qq.difficulty_level, coalesce(u.uses, 0) asc, random()
  ) q;

  return v_game;
end;
$$;
revoke execute on function public.create_game(public.game_mode) from public, anon, authenticated;
grant execute on function public.create_game(public.game_mode) to service_role;
