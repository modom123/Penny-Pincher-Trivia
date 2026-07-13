-- Skips (a lifeline): a player may decline to answer a round for ZERO points and
-- NO penalty, up to a per-game limit (default 3). Skipping consumes the round like
-- an answer (you can't then answer it), so it only ever helps by dodging the
-- wrong-answer penalty on a question you don't know.

alter table public.games add column if not exists max_skips int not null default 3;
alter table public.player_game_stats add column if not exists skips_used int not null default 0;
alter table public.player_answers add column if not exists is_skip boolean not null default false;

-- skip_round: record a skip for the caller on an open round they've bought.
create or replace function public.skip_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_max_skips int;
  v_used int;
  v_question_id uuid;
  v_answer_id uuid;
  v_grace_ms constant int := 500;
  v_elapsed_ms int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select gr.started_at, gr.ended_at, gr.question_id,
         coalesce(gr.time_limit_override_seconds, q.time_limit_seconds) as time_limit_seconds
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number
  for update of gr;
  if not found then raise exception 'Round not found for this game'; end if;
  if v_round.started_at is null then raise exception 'This round has not started yet'; end if;
  if v_round.ended_at is not null then raise exception 'This round is not currently accepting answers'; end if;

  v_elapsed_ms := extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000;
  if v_elapsed_ms > v_round.time_limit_seconds * 1000 + v_grace_ms then
    raise exception 'SKIP_TOO_LATE: the round has closed';
  end if;

  -- Must have entered (bought) this round to skip it.
  if not exists (
    select 1 from public.player_game_stats
    where user_id = v_user_id and game_id = p_game_id and current_round_reached >= p_round_number
  ) then
    raise exception 'You must buy this round before skipping it';
  end if;

  select coalesce(max_skips, 3) into v_max_skips from public.games where game_id = p_game_id;
  select skips_used into v_used from public.player_game_stats
    where user_id = v_user_id and game_id = p_game_id for update;
  if coalesce(v_used, 0) >= v_max_skips then
    raise exception 'SKIP_LIMIT_REACHED: you have used all % skips this game', v_max_skips;
  end if;

  insert into public.player_answers
    (user_id, game_id, round_number, question_id, selected_option, is_correct, is_skip, time_taken_ms, points_awarded)
  values (v_user_id, p_game_id, p_round_number, v_round.question_id, null, false, true, v_elapsed_ms::int, 0)
  on conflict (user_id, game_id, round_number) do nothing
  returning id into v_answer_id;
  if v_answer_id is null then
    raise exception 'You already answered or skipped this round';
  end if;

  update public.player_game_stats set skips_used = skips_used + 1
  where user_id = v_user_id and game_id = p_game_id
  returning skips_used into v_used;

  insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
  values (v_user_id, p_game_id, p_round_number, 'answer_accepted', v_elapsed_ms::int,
          jsonb_build_object('skip', true, 'skipsUsed', v_used));

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'skipped', true,
    'skipsUsed', v_used,
    'skipsRemaining', greatest(v_max_skips - v_used, 0)
  );
end;
$$;

revoke execute on function public.skip_round(uuid, int) from public, anon;
grant execute on function public.skip_round(uuid, int) to authenticated;
