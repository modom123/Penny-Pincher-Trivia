-- Require a paid entry before playing an entry-fee tournament, so no one skips
-- the sign-up buy-in that seeds the pot by jumping straight into buy_round.
--
-- register_for_game (Sign up / Join now) creates the player's player_game_stats
-- row when it takes their entry fee. buy_round already computes v_is_first_entry
-- (no such row yet); we just reject a first entry via buy_round when the game
-- carries an entry fee. Registered players have a row, so they pass. Games with
-- entry_fee_cents = 0 (every manually created game today) are unaffected.
--
-- Faithful reproduction of the current buy_round (20260707011000) with only the
-- ENTRY_REQUIRED guard added. Requires migration 20260714010000 first (it adds
-- games.entry_fee_cents).

create or replace function public.buy_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round_cost int;
  v_promo_used int;
  v_cash_used int;
  v_admin_cut int;
  v_prize_cut int;
  v_profile record;
  v_round record;
  v_game record;
  v_streak_free boolean := false;
  v_is_first_entry boolean;
  v_tokens_spent_so_far int;
  v_blocked_states jsonb;
  v_allowed_states jsonb;
  v_top_up_window_last_round constant int := 30;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select wallet_balance_cents, promo_balance_cents, is_suspended, region_state into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.is_suspended then
    raise exception 'Account suspended';
  end if;

  select value into v_blocked_states from public.platform_config where key = 'blocked_states';
  select value into v_allowed_states from public.platform_config where key = 'allowed_states';
  if v_profile.region_state is null then
    raise exception 'LOCATION_REQUIRED: We could not verify your location. Cash games require location verification.';
  end if;
  -- Whitelist: if an allowlist is configured, the region must be on it.
  if v_allowed_states is not null and jsonb_array_length(v_allowed_states) > 0
     and not (v_allowed_states ? v_profile.region_state) then
    raise exception 'REGION_BLOCKED: Penny Pincher cash games are currently unavailable in your region.';
  end if;
  -- Denylist override.
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

  select not exists (
    select 1 from public.player_game_stats where user_id = v_user_id and game_id = p_game_id
  ) into v_is_first_entry;

  -- Entry-fee tournaments require a paid sign-up first (register_for_game, shown
  -- as Sign up / Join now in the lobby). Block a first play via buy_round so the
  -- pot-seeding buy-in can't be skipped. Registered players already have a stats
  -- row, so this never fires for them; entry_fee_cents = 0 games are unaffected.
  if v_is_first_entry and coalesce(v_game.entry_fee_cents, 0) > 0 then
    raise exception 'ENTRY_REQUIRED: This tournament requires a paid entry. Tap Join now in the lobby to enter before you can play.';
  end if;

  select coalesce(total_tokens_spent_cents, 0) into v_tokens_spent_so_far
  from public.player_game_stats where user_id = v_user_id and game_id = p_game_id;
  v_tokens_spent_so_far := coalesce(v_tokens_spent_so_far, 0);

  if v_is_first_entry and v_game.min_buy_in_tokens is not null
     and v_profile.wallet_balance_cents < v_game.min_buy_in_tokens then
    raise exception 'MIN_BUYIN_REQUIRED: This game requires a minimum buy-in of % tokens to join. Your balance is % tokens.',
      v_game.min_buy_in_tokens, v_profile.wallet_balance_cents;
  end if;

  if v_round_cost > 0 and v_game.max_buy_in_tokens is not null
     and v_tokens_spent_so_far + v_round_cost > v_game.max_buy_in_tokens then
    raise exception 'MAX_BUYIN_REACHED: This game caps total buy-in at % tokens. You have spent % and this round costs %.',
      v_game.max_buy_in_tokens, v_tokens_spent_so_far, v_round_cost;
  end if;

  if v_round_cost > 0 and v_profile.wallet_balance_cents < v_round_cost then
    if v_round.is_overtime then
      raise exception 'Insufficient tokens in wallet for this round';
    elsif p_round_number <= v_top_up_window_last_round then
      raise exception 'TOP_UP_REQUIRED: Not enough tokens for round %. Top up your account to continue (top-ups allowed through round %).',
        p_round_number, v_top_up_window_last_round;
    else
      update public.player_game_stats set is_eliminated = true
      where user_id = v_user_id and game_id = p_game_id;

      insert into public.websocket_logs (user_id, game_id, round_number, event_type, detail)
      values (v_user_id, p_game_id, p_round_number, 'eliminated_insufficient_funds',
              jsonb_build_object('roundCostCents', v_round_cost, 'walletBalanceCents', v_profile.wallet_balance_cents));

      return jsonb_build_object(
        'success', false, 'gameOver', true, 'reason', 'ELIMINATED_INSUFFICIENT_FUNDS',
        'message', format('You could not afford round %s and the top-up window (through round %s) has closed. Game over.',
                          p_round_number, v_top_up_window_last_round)
      );
    end if;
  end if;

  v_promo_used := least(v_round_cost, v_profile.promo_balance_cents);
  v_cash_used := v_round_cost - v_promo_used;

  v_admin_cut := round(v_cash_used * 0.40);
  v_prize_cut := v_cash_used - v_admin_cut;

  if v_round_cost > 0 then
    update public.profiles
    set wallet_balance_cents = wallet_balance_cents - v_round_cost,
        promo_balance_cents = promo_balance_cents - v_promo_used
    where user_id = v_user_id;
  end if;

  update public.games
  set total_prize_pool_cents = total_prize_pool_cents + v_prize_cut,
      admin_revenue_pool_cents = admin_revenue_pool_cents + v_admin_cut
  where game_id = p_game_id
  returning * into v_game;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id, round_number)
  values (v_user_id, 'round_debit', -v_round_cost, p_game_id, p_round_number);

  insert into public.player_game_stats
    (user_id, game_id, current_round_reached, total_cash_spent_cents, total_tokens_spent_cents)
  values (v_user_id, p_game_id, p_round_number, v_cash_used, v_round_cost)
  on conflict (user_id, game_id) do update set
    current_round_reached = excluded.current_round_reached,
    total_cash_spent_cents = public.player_game_stats.total_cash_spent_cents + excluded.total_cash_spent_cents,
    total_tokens_spent_cents = public.player_game_stats.total_tokens_spent_cents + excluded.total_tokens_spent_cents;

  return jsonb_build_object(
    'success', true,
    'gameOver', false,
    'deductedCents', v_round_cost,
    'promoUsedCents', v_promo_used,
    'cashUsedCents', v_cash_used,
    'streakFree', v_streak_free,
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
