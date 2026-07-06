-- Player-facing functions, callable via RPC as the authenticated user
-- (auth.uid() identifies the caller). All are SECURITY DEFINER so they can
-- read/write tables that have no direct client policies (questions,
-- game_rounds) while still enforcing every business rule themselves.
--
-- NOTE: Supabase's `public` schema has ALTER DEFAULT PRIVILEGES that
-- auto-grant EXECUTE to anon/authenticated/service_role on every new
-- function. `revoke ... from public` alone does NOT remove those - you must
-- revoke from the named roles (anon, authenticated) explicitly, which is
-- what every REVOKE below does.

create function public.buy_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round_cost int := p_round_number; -- round N costs N cents/tokens
  v_admin_cut int;
  v_prize_cut int;
  v_profile record;
  v_round record;
  v_game record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_round_number < 1 or p_round_number > 100 then
    raise exception 'roundNumber must be between 1 and 100';
  end if;

  select wallet_balance_cents, is_suspended into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.is_suspended then
    raise exception 'Account suspended';
  end if;
  if v_profile.wallet_balance_cents < v_round_cost then
    raise exception 'Insufficient tokens in wallet for this round';
  end if;

  select * into v_round from public.game_rounds
  where game_id = p_game_id and round_number = p_round_number for update;
  if not found then
    raise exception 'Round not found for this game';
  end if;

  select * into v_game from public.games
  where game_id = p_game_id and status = 'active' for update;
  if not found then
    raise exception 'Game is not active';
  end if;
  if v_game.current_round <> p_round_number then
    raise exception 'Round % is not the currently open round (current round is %)', p_round_number, v_game.current_round;
  end if;

  v_admin_cut := round(v_round_cost * 0.40);
  v_prize_cut := v_round_cost - v_admin_cut;

  update public.profiles set wallet_balance_cents = wallet_balance_cents - v_round_cost
  where user_id = v_user_id;

  update public.games
  set total_prize_pool_cents = total_prize_pool_cents + v_prize_cut,
      admin_revenue_pool_cents = admin_revenue_pool_cents + v_admin_cut
  where game_id = p_game_id
  returning * into v_game;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id, round_number)
  values (v_user_id, 'round_debit', -v_round_cost, p_game_id, p_round_number);

  insert into public.player_game_stats (user_id, game_id, current_round_reached)
  values (v_user_id, p_game_id, p_round_number)
  on conflict (user_id, game_id) do update set current_round_reached = excluded.current_round_reached;

  return jsonb_build_object(
    'success', true,
    'deductedCents', v_round_cost,
    'gamePoolState', jsonb_build_object(
      'gameId', v_game.game_id,
      'currentRound', v_game.current_round,
      'totalPrizePoolCents', v_game.total_prize_pool_cents
    )
  );
end;
$$;

revoke execute on function public.buy_round(uuid, int) from public, anon, authenticated;
grant execute on function public.buy_round(uuid, int) to authenticated;


create function public.submit_answer(p_game_id uuid, p_round_number int, p_selected_option varchar)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_time_taken_ms int;
  v_grace_ms constant int := 500;
  v_min_human_reaction_ms constant int := 300;
  v_disqualify_after_flags constant int := 3;
  v_entry record;
  v_is_correct boolean;
  v_points int;
  v_answer_id uuid;
  v_flag_count int;
  v_cheat_flagged boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select gr.round_number, gr.started_at, gr.ended_at, q.correct_option, q.time_limit_seconds
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number
  for update of gr;
  if not found then
    raise exception 'Round not found for this game';
  end if;
  if v_round.started_at is null then
    raise exception 'This round has not started yet';
  end if;
  if v_round.ended_at is not null then
    raise exception 'This round is not currently accepting answers';
  end if;

  -- Server clock is the only source of truth for timing - the client's
  -- reported timestamp is never trusted for scoring or cutoff.
  v_time_taken_ms := extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000;
  if v_time_taken_ms > v_round.time_limit_seconds * 1000 + v_grace_ms then
    raise exception 'Answer rejected: submitted after the round closed';
  end if;

  select current_round_reached into v_entry
  from public.player_game_stats where user_id = v_user_id and game_id = p_game_id for update;
  if not found or v_entry.current_round_reached < p_round_number then
    raise exception 'You must buy this round before answering (spectators cannot score)';
  end if;

  v_is_correct := p_selected_option = v_round.correct_option;
  v_points := case when v_is_correct
    then p_round_number * 10 + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0)
    else 0
  end;

  insert into public.player_answers
    (user_id, game_id, round_number, question_id, selected_option, is_correct, time_taken_ms, points_awarded)
  select v_user_id, p_game_id, p_round_number, gr.question_id, p_selected_option, v_is_correct, v_time_taken_ms::int, v_points
  from public.game_rounds gr where gr.game_id = p_game_id and gr.round_number = p_round_number
  on conflict (user_id, game_id, round_number) do nothing
  returning id into v_answer_id;
  if v_answer_id is null then
    raise exception 'You already answered this round';
  end if;

  update public.player_game_stats set total_score = total_score + v_points
  where user_id = v_user_id and game_id = p_game_id;

  if v_time_taken_ms < v_min_human_reaction_ms then
    v_cheat_flagged := true;
    insert into public.cheat_flags (user_id, game_id, round_number, reason)
    values (v_user_id, p_game_id, p_round_number, 'input_velocity_too_fast');

    select count(*) into v_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id;

    if v_flag_count >= v_disqualify_after_flags then
      update public.player_game_stats set is_eligible_for_grand_prize = false
      where user_id = v_user_id and game_id = p_game_id;
    end if;
  end if;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'isCorrect', v_is_correct,
    'pointsAwarded', v_points,
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$$;

revoke execute on function public.submit_answer(uuid, int, varchar) from public, anon, authenticated;
grant execute on function public.submit_answer(uuid, int, varchar) to authenticated;


create function public.dev_credit_wallet(p_cents int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_cents is null or p_cents <= 0 or p_cents > 100000 then
    raise exception 'cents must be a positive integer up to 100000';
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents + p_cents
  where user_id = v_user_id
  returning wallet_balance_cents into v_balance;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (v_user_id, 'deposit', p_cents, 'dev-credit');

  return jsonb_build_object('wallet_balance_cents', v_balance);
end;
$$;

comment on function public.dev_credit_wallet(int) is
  'Dev/test-only helper to fund a wallet without a real Stripe purchase. Consider revoking EXECUTE from authenticated before a production launch.';

revoke execute on function public.dev_credit_wallet(int) from public, anon, authenticated;
grant execute on function public.dev_credit_wallet(int) to authenticated;
