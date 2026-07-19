-- Consistency pass: register_for_game had its own copy of the region-gating
-- logic that predates the geofence master switch (20260718000000) and was
-- missed when that switch was added to buy_round/my_compliance_status. When
-- staff turns geofencing off, signing up for a game still enforced
-- LOCATION_REQUIRED/REGION_BLOCKED - fixed to match.
create or replace function public.register_for_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_game record;
  v_cash_available int;
  v_fee int;
  v_rake_bps int;
  v_admin_cut int;
  v_prize_cut int;
  v_geofence_enabled boolean;
  v_blocked_states jsonb;
  v_allowed_states jsonb;
  v_player_count int;
  v_cutoff int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select wallet_balance_cents, promo_balance_cents, is_suspended, region_state into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_suspended then raise exception 'Account suspended'; end if;

  -- Region gating (mirrors buy_round: a real-money transaction). Skipped
  -- entirely while geofence_enabled is false, same as buy_round.
  select coalesce((value)::boolean, true) into v_geofence_enabled
  from public.platform_config where key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, true);

  if v_geofence_enabled then
    select value into v_blocked_states from public.platform_config where key = 'blocked_states';
    select value into v_allowed_states from public.platform_config where key = 'allowed_states';
    if v_profile.region_state is null then
      raise exception 'LOCATION_REQUIRED: We could not verify your location. Cash games require location verification.';
    end if;
    if v_allowed_states is not null and jsonb_array_length(v_allowed_states) > 0
       and not (v_allowed_states ? v_profile.region_state) then
      raise exception 'REGION_BLOCKED: Penny Pincher cash games are currently unavailable in your region.';
    end if;
    if v_blocked_states ? v_profile.region_state then
      raise exception 'REGION_BLOCKED: Penny Pincher cash games are currently unavailable in your region.';
    end if;
  end if;

  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;

  select coalesce((value #>> '{}')::int, 30) into v_cutoff
  from public.platform_config where key = 'late_join_cutoff_round';
  v_cutoff := coalesce(v_cutoff, 30);

  -- Two ways in: sign up before an upcoming game starts, or join an in-progress
  -- tournament while it's still inside the re-up window (current round <= cutoff).
  if v_game.status = 'registration' then
    if v_game.scheduled_start_at is not null and now() >= v_game.scheduled_start_at then
      raise exception 'Sign-ups for this game have closed';
    end if;
  elsif v_game.status = 'active' then
    if v_game.current_round > v_cutoff then
      raise exception 'JOIN_CLOSED: This tournament is past round % - joining closes at round %.',
        v_game.current_round, v_cutoff;
    end if;
  else
    raise exception 'This game is not open to join (status is %)', v_game.status;
  end if;

  if exists (select 1 from public.player_game_stats where game_id = p_game_id and user_id = v_user_id) then
    raise exception 'ALREADY_REGISTERED: You are already in this game';
  end if;

  v_fee := coalesce(v_game.entry_fee_cents, 0);
  -- Cash-only (wallet minus non-withdrawable promo), so every seat funds the pot.
  v_cash_available := v_profile.wallet_balance_cents - v_profile.promo_balance_cents;
  if v_fee > 0 and v_cash_available < v_fee then
    raise exception 'INSUFFICIENT_CASH: Signing up costs %c cash. Your withdrawable cash balance is %c.',
      v_fee, greatest(v_cash_available, 0);
  end if;

  select coalesce((value #>> '{}')::int, 0) into v_rake_bps from public.platform_config where key = 'entry_fee_rake_bps';
  v_rake_bps := coalesce(v_rake_bps, 0);
  v_admin_cut := round(v_fee * v_rake_bps / 10000.0);
  v_prize_cut := v_fee - v_admin_cut;

  if v_fee > 0 then
    update public.profiles
      set wallet_balance_cents = wallet_balance_cents - v_fee
      where user_id = v_user_id;

    update public.games
      set total_prize_pool_cents = total_prize_pool_cents + v_prize_cut,
          admin_revenue_pool_cents = admin_revenue_pool_cents + v_admin_cut
      where game_id = p_game_id returning * into v_game;

    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_user_id, 'entry_fee_debit', -v_fee, p_game_id);
  end if;

  insert into public.player_game_stats
    (user_id, game_id, current_round_reached, total_cash_spent_cents, total_tokens_spent_cents)
  values (v_user_id, p_game_id, 0, v_fee, v_fee);

  select count(*) into v_player_count from public.player_game_stats where game_id = p_game_id;

  return jsonb_build_object(
    'success', true,
    'gameId', p_game_id,
    'entryFeeCents', v_fee,
    'scheduledStartAt', v_game.scheduled_start_at,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'playerCount', v_player_count
  );
end;
$$;
