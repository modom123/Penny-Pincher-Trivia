-- Staff-created games previously skipped straight to 'pending' (immediately
-- eligible to be driven live by the engine) with min_players stuck at its
-- column default of 1 and scheduled_start_at always null - i.e. no player-count
-- gate at all, unlike the auto-scheduler's own games. That's why a
-- Command-Center-created game could start running with nobody in it.
--
-- New flow for staff-created games: they now enter 'registration' (open to
-- join, not running) with a real min_players threshold (default 3, staff can
-- set another value). Once enough players have joined, a 24-hour countdown
-- starts; the existing engine_promote_due_registrations/engine_runnable_games
-- (unchanged) take it from there once that countdown elapses - same machinery
-- the auto-scheduler's games already use.

-- admin_create_game: add p_min_players; auto-approved games go straight to
-- 'registration' (open to join, waiting on players) instead of 'pending'
-- (immediately runnable regardless of headcount). Reviewed (non-auto-approve)
-- games still start as 'draft' - see admin_approve_game below for what
-- approving one now does.
drop function if exists public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean, int, int, int);
create or replace function public.admin_create_game(
  p_mode public.game_mode default 'original_escalator',
  p_payout_scheme public.payout_scheme default 'standard',
  p_round_seconds int default 12,
  p_auto_approve boolean default false,
  p_min_buy_in_tokens int default null,
  p_max_buy_in_tokens int default null,
  p_reup_cutoff_round int default 30,
  p_min_players int default 3)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_secs int := least(greatest(coalesce(p_round_seconds, 12), 5), 60);
  v_status text := case when p_auto_approve then 'registration' else 'draft' end;
  v_cutoff int := least(greatest(coalesce(p_reup_cutoff_round, 30), 1), 100);
  v_min_players int := greatest(coalesce(p_min_players, 3), 1);
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_min_buy_in_tokens is not null and p_max_buy_in_tokens is not null
     and p_min_buy_in_tokens > p_max_buy_in_tokens then
    raise exception 'min_buy_in_tokens (%) cannot exceed max_buy_in_tokens (%)', p_min_buy_in_tokens, p_max_buy_in_tokens;
  end if;
  v_game := public.create_game(p_mode);
  update public.games
    set payout_scheme = p_payout_scheme, round_seconds = v_secs, status = v_status,
        min_buy_in_tokens = p_min_buy_in_tokens, max_buy_in_tokens = p_max_buy_in_tokens,
        reup_cutoff_round = v_cutoff, min_players = v_min_players, scheduled_start_at = null
    where game_id = v_game.game_id returning * into v_game;
  update public.game_rounds
    set time_limit_override_seconds = v_secs
    where game_id = v_game.game_id;
  perform public.log_admin_action(
    case when p_auto_approve then 'create_game_auto' else 'create_game' end,
    null, v_game.game_id,
    jsonb_build_object('mode', p_mode, 'payoutScheme', p_payout_scheme,
      'roundSeconds', v_secs, 'autoApprove', p_auto_approve,
      'minBuyInTokens', p_min_buy_in_tokens, 'maxBuyInTokens', p_max_buy_in_tokens,
      'reupCutoffRound', v_cutoff, 'minPlayers', v_min_players));
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean, int, int, int, int) from public, anon;
grant execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean, int, int, int, int) to authenticated;

-- admin_approve_game: a reviewed draft now opens for registration (waits on
-- players) instead of going straight to 'pending' (immediately runnable).
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
  update public.games set status = 'registration' where game_id = p_game_id returning * into v_game;
  perform public.log_admin_action('approve_game', null, p_game_id,
    jsonb_build_object('mode', v_game.mode, 'payoutScheme', v_game.payout_scheme));
  return v_game;
end;
$$;

-- admin_cancel_game: 'registration' games (waiting on players, possibly mid
-- countdown) can now be cancelled too, same as draft/pending. Unlike
-- draft/old-style pending, a 'registration' game can have real players who
-- already paid a cash entry fee (that's the whole point of the new
-- sign-up window) - refund each of them before cancelling, or their money
-- would be stranded in a game that will never run or pay out. draft/pending
-- games never had signups open (register_for_game only accepts
-- 'registration'/'active'), so there's nothing to refund for those.
create or replace function public.admin_cancel_game(p_game_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_previous_status text;
  v_refunded_cents int := 0;
  v_refunded_players int := 0;
  v_player record;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status not in ('draft', 'pending', 'registration') then
    raise exception 'Only a draft, pending, or registration-stage game can be cancelled (this game is %)', v_game.status;
  end if;
  v_previous_status := v_game.status;

  if v_previous_status = 'registration' then
    for v_player in
      select user_id, total_cash_spent_cents from public.player_game_stats
      where game_id = p_game_id and total_cash_spent_cents > 0
    loop
      update public.profiles set wallet_balance_cents = wallet_balance_cents + v_player.total_cash_spent_cents
      where user_id = v_player.user_id;
      insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
      values (v_player.user_id, 'game_cancelled_refund', v_player.total_cash_spent_cents, p_game_id);
      v_refunded_cents := v_refunded_cents + v_player.total_cash_spent_cents;
      v_refunded_players := v_refunded_players + 1;
    end loop;
  end if;

  update public.games set status = 'cancelled' where game_id = p_game_id returning * into v_game;
  perform public.log_admin_action('cancel_game', null, p_game_id,
    jsonb_build_object('previousStatus', v_previous_status, 'refundedCents', v_refunded_cents, 'refundedPlayers', v_refunded_players));
  return v_game;
end;
$$;

-- register_for_game: once this registration brings the game's player count up
-- to min_players, start the 24-hour countdown to launch (only if one hasn't
-- already been set - e.g. by the auto-scheduler's own rollover logic).
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

  -- Start the 24h countdown the moment min_players is reached - not before,
  -- and only once (a countdown already running, e.g. from an earlier
  -- threshold-crossing or the auto-scheduler's own rollover, is left alone).
  if v_game.status = 'registration' and v_game.scheduled_start_at is null
     and v_player_count >= v_game.min_players then
    update public.games
      set scheduled_start_at = now() + interval '24 hours'
      where game_id = p_game_id
      returning * into v_game;
  end if;

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
