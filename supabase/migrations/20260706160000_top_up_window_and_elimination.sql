-- Buy-in funding rule:
--   * Wallet never goes negative (existing CHECK stays).
--   * Rounds 1..30 (the top-up window): if you can't afford the round you are
--     blocked (TOP_UP_REQUIRED) but NOT eliminated - top up and continue.
--   * Round 31+ : the first round you can't afford ends your game - you're
--     eliminated and out of prize contention.
-- Overtime rounds keep the plain insufficient-funds behaviour (no top-up grace).
create or replace function public.buy_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round_cost int;
  v_admin_cut int;
  v_prize_cut int;
  v_profile record;
  v_round record;
  v_game record;
  v_streak_free boolean := false;
  v_blocked_states jsonb;
  v_top_up_window_last_round constant int := 30;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select wallet_balance_cents, is_suspended, region_state into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.is_suspended then
    raise exception 'Account suspended';
  end if;

  -- Geo-fence: block buy-ins from restricted / unverified states.
  select value into v_blocked_states from public.platform_config where key = 'blocked_states';
  if v_profile.region_state is null then
    raise exception 'LOCATION_REQUIRED: We could not verify your location. Cash games require location verification.';
  end if;
  if v_blocked_states ? v_profile.region_state then
    raise exception 'REGION_BLOCKED: Penny Pincher cash games are currently unavailable in your region.';
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

  if v_round.is_overtime then
    if not exists (select 1 from public.sudden_death_participants where game_id = p_game_id and user_id = v_user_id) then
      raise exception 'Not eligible for sudden death overtime';
    end if;
  end if;

  if v_game.mode = 'streak_saver' and p_round_number > 1 and not v_round.is_overtime then
    select exists (
      select 1 from public.player_answers
      where user_id = v_user_id and game_id = p_game_id and round_number = p_round_number - 1 and is_correct = true
    ) into v_streak_free;
  end if;

  v_round_cost := case when v_streak_free then 0 else v_round.cost_cents end;

  -- Insufficient funds handling.
  if v_round_cost > 0 and v_profile.wallet_balance_cents < v_round_cost then
    if v_round.is_overtime then
      raise exception 'Insufficient tokens in wallet for this round';
    elsif p_round_number <= v_top_up_window_last_round then
      -- Top-up window: pause, don't eliminate. Player tops up and retries.
      raise exception 'TOP_UP_REQUIRED: Not enough tokens for round %. Top up your account to continue (top-ups allowed through round %).',
        p_round_number, v_top_up_window_last_round;
    else
      -- Window closed: first unaffordable round ends the game for this player.
      -- Persist elimination (return without raising so the update commits).
      update public.player_game_stats set is_eliminated = true
      where user_id = v_user_id and game_id = p_game_id;

      insert into public.websocket_logs (user_id, game_id, round_number, event_type, detail)
      values (v_user_id, p_game_id, p_round_number, 'eliminated_insufficient_funds',
              jsonb_build_object('roundCostCents', v_round_cost, 'walletBalanceCents', v_profile.wallet_balance_cents));

      return jsonb_build_object(
        'success', false,
        'gameOver', true,
        'reason', 'ELIMINATED_INSUFFICIENT_FUNDS',
        'message', format('You could not afford round %s and the top-up window (through round %s) has closed. Game over.',
                          p_round_number, v_top_up_window_last_round)
      );
    end if;
  end if;

  v_admin_cut := round(v_round_cost * 0.40);
  v_prize_cut := v_round_cost - v_admin_cut;

  if v_round_cost > 0 then
    update public.profiles set wallet_balance_cents = wallet_balance_cents - v_round_cost
    where user_id = v_user_id;
  end if;

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
    'gameOver', false,
    'deductedCents', v_round_cost,
    'streakFree', v_streak_free,
    'gamePoolState', jsonb_build_object(
      'gameId', v_game.game_id,
      'currentRound', v_game.current_round,
      'totalPrizePoolCents', v_game.total_prize_pool_cents
    )
  );
end;
$$;
