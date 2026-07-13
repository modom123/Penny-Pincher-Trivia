-- Review-and-approve gate for games. New games are created as 'draft' and do
-- NOT run until a staff member approves them (the game-engine only picks up
-- status = 'pending'). Approve flips draft -> pending; reject flips it to
-- 'cancelled'. Lets staff set mode + payout scheme, then sign off before a
-- game goes live and takes real money.

-- New games default to draft (covers create_game_for_subject, which relies on
-- the column default).
alter table public.games alter column status set default 'draft';

-- create_game: build the game as a DRAFT (was 'pending'). Body otherwise
-- unchanged (seeds the 100 rounds per mode).
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
    select distinct on (difficulty_level) difficulty_level, question_id
    from public.questions
    where difficulty_level between 1 and 100
    order by difficulty_level, random()
  ) q;

  return v_game;
end;
$$;
revoke execute on function public.create_game(public.game_mode) from public, anon, authenticated;
grant execute on function public.create_game(public.game_mode) to service_role;

-- Approve a draft: draft -> pending (the engine then runs it). Staff only.
create or replace function public.admin_approve_game(p_game_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'draft' then
    raise exception 'Only draft games can be approved (this game is %)', v_game.status;
  end if;
  update public.games set status = 'pending' where game_id = p_game_id returning * into v_game;
  perform public.log_admin_action('approve_game', null, p_game_id,
    jsonb_build_object('mode', v_game.mode, 'payoutScheme', v_game.payout_scheme));
  return v_game;
end;
$$;
revoke execute on function public.admin_approve_game(uuid) from public, anon;
grant execute on function public.admin_approve_game(uuid) to authenticated;

-- Reject/cancel a game that hasn't started (draft or approved-but-not-running).
create or replace function public.admin_cancel_game(p_game_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status not in ('draft', 'pending') then
    raise exception 'Only a draft or pending game can be cancelled (this game is %)', v_game.status;
  end if;
  update public.games set status = 'cancelled' where game_id = p_game_id returning * into v_game;
  perform public.log_admin_action('cancel_game', null, p_game_id,
    jsonb_build_object('previousStatus', v_game.status));
  return v_game;
end;
$$;
revoke execute on function public.admin_cancel_game(uuid) from public, anon;
grant execute on function public.admin_cancel_game(uuid) to authenticated;
