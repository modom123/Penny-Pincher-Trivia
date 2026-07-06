-- Service-role-only functions. These are never granted to anon/authenticated -
-- they're invoked by Edge Functions and the game-engine worker, both of
-- which authenticate to Supabase using the service_role key.

create function public.create_game()
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_missing int[];
begin
  insert into public.games (status, current_round, total_rounds) values ('pending', 0, 100) returning * into v_game;

  select array_agg(r) into v_missing
  from generate_series(1, 100) r
  where not exists (select 1 from public.questions q where q.difficulty_level = r);
  if v_missing is not null then
    raise exception 'No question bank entries for rounds: %', v_missing;
  end if;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  select v_game.game_id, q.difficulty_level, q.question_id, q.difficulty_level
  from (
    select distinct on (difficulty_level) difficulty_level, question_id
    from public.questions
    where difficulty_level between 1 and 100
    order by difficulty_level, random()
  ) q;

  return v_game;
end;
$$;

revoke execute on function public.create_game() from public, anon, authenticated;
grant execute on function public.create_game() to service_role;


create function public.start_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
begin
  update public.games
  set current_round = p_round_number,
      status = 'active',
      started_at = coalesce(started_at, now())
  where game_id = p_game_id;

  update public.game_rounds set started_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select gr.round_number, gr.cost_cents, gr.started_at, q.question_text, q.options, q.time_limit_seconds
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;
  if not found then
    raise exception 'No question configured for round %', p_round_number;
  end if;

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;

revoke execute on function public.start_round(uuid, int) from public, anon, authenticated;
grant execute on function public.start_round(uuid, int) to service_role;


create function public.end_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_correct varchar(1);
  v_total_rounds int;
  v_leaderboard jsonb;
begin
  update public.game_rounds set ended_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select q.correct_option into v_correct
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;

  select total_rounds into v_total_rounds from public.games where game_id = p_game_id;

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
    'isFinalRound', p_round_number >= v_total_rounds
  );
end;
$$;

revoke execute on function public.end_round(uuid, int) from public, anon, authenticated;
grant execute on function public.end_round(uuid, int) to service_role;


create function public.payout_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_game record;
  v_winner record;
  v_place int := 0;
  v_distributed int := 0;
  v_share int;
  v_payouts jsonb := '[]'::jsonb;
  v_winner_count int;
begin
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status = 'completed' then
    raise exception 'Game already paid out';
  end if;
  if v_game.current_round < v_game.total_rounds then
    raise exception 'Game has not reached its final round yet (%/%)', v_game.current_round, v_game.total_rounds;
  end if;

  select count(*) into v_winner_count from public.player_game_stats
  where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false;

  for v_winner in
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    order by total_score desc limit 3
  loop
    v_place := v_place + 1;
    v_share := case
      when v_place = least(v_winner_count, 3) then v_game.total_prize_pool_cents - v_distributed -- remainder to last place, avoids rounding loss
      when v_place = 1 then round(v_game.total_prize_pool_cents * 0.5)
      when v_place = 2 then round(v_game.total_prize_pool_cents * 0.3)
      else round(v_game.total_prize_pool_cents * 0.2)
    end;
    v_distributed := v_distributed + v_share;

    update public.profiles set wallet_balance_cents = wallet_balance_cents + v_share
    where user_id = v_winner.user_id;

    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_winner.user_id, 'payout', v_share, p_game_id);

    v_payouts := v_payouts || jsonb_build_object(
      'userId', v_winner.user_id, 'place', v_place, 'amountCents', v_share, 'totalScore', v_winner.total_score
    );
  end loop;

  update public.games set status = 'completed', completed_at = now() where game_id = p_game_id;

  return jsonb_build_object(
    'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'payouts', v_payouts
  );
end;
$$;

revoke execute on function public.payout_game(uuid) from public, anon, authenticated;
grant execute on function public.payout_game(uuid) to service_role;
