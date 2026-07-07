-- Active Arena UI needs a live prize-pool value. Add totalPrizePoolCents to the
-- start_round and end_round broadcast payloads so the game screen can render (and
-- refresh) the "Live Prize Pool" ticker each round. Behaviour is otherwise
-- identical to the prior definitions.
create or replace function public.start_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
  v_game record;
  v_pool int;
  v_bonus_cents constant int := 500; -- $5 platform-funded booster; [OPS: tune], [COUNSEL: confirm legality before enabling milestone_booster]
begin
  update public.games
  set current_round = p_round_number,
      status = 'active',
      started_at = coalesce(started_at, now())
  where game_id = p_game_id
  returning * into v_game;

  update public.game_rounds set started_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  if v_game.mode = 'milestone_booster' and p_round_number in (25, 50, 75) then
    insert into public.game_bonus_injections (game_id, round_number, amount_cents)
    values (p_game_id, p_round_number, v_bonus_cents)
    on conflict (game_id, round_number) do nothing;

    if found then
      update public.games set total_prize_pool_cents = total_prize_pool_cents + v_bonus_cents
      where game_id = p_game_id;
    end if;
  end if;

  select gr.round_number, gr.cost_cents, gr.started_at, gr.is_overtime,
         coalesce(gr.time_limit_override_seconds, q.time_limit_seconds) as time_limit_seconds,
         q.question_text, q.options
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;
  if not found then
    raise exception 'No question configured for round %', p_round_number;
  end if;

  -- Fresh read: reflects any milestone bonus injected above.
  select total_prize_pool_cents into v_pool from public.games where game_id = p_game_id;

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'isOvertime', v_round.is_overtime,
    'totalPrizePoolCents', v_pool,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;

revoke execute on function public.start_round(uuid, int) from public, anon, authenticated;
grant execute on function public.start_round(uuid, int) to service_role;

create or replace function public.end_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_correct varchar(1);
  v_total_rounds int;
  v_pool int;
  v_leaderboard jsonb;
begin
  update public.game_rounds set ended_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select q.correct_option into v_correct
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;

  select total_rounds, total_prize_pool_cents into v_total_rounds, v_pool
  from public.games where game_id = p_game_id;

  select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'score', total_score)), '[]'::jsonb)
  into v_leaderboard
  from (
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id order by total_score desc limit 10
  ) top;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'correctOption', v_correct,
    'leaderboard', v_leaderboard,
    'totalPrizePoolCents', v_pool,
    'isFinalRound', p_round_number >= v_total_rounds
  );
end;
$$;

revoke execute on function public.end_round(uuid, int) from public, anon, authenticated;
grant execute on function public.end_round(uuid, int) to service_role;
