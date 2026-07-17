-- Poker-style buy-in for a tournament: staff can now set a minimum buy-in, a
-- maximum buy-in, and the last round re-ups ("top-ups") are allowed through,
-- all per game. min_buy_in_tokens/max_buy_in_tokens already existed as plain
-- columns (20260706170000) with no enforcement gaps and no staff-facing way to
-- set them; the re-up cutoff was a hardcoded round-30 constant in buy_round.
-- This makes the cutoff a per-game column and wires all three into
-- admin_create_game.

alter table public.games add column if not exists reup_cutoff_round int not null default 30;

-- buy_round: re-up cutoff round becomes per-game (games.reup_cutoff_round) instead
-- of a hardcoded constant. Everything else is unchanged from 20260714020000.
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
  v_top_up_window_last_round int;
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
  if v_allowed_states is not null and jsonb_array_length(v_allowed_states) > 0
     and not (v_allowed_states ? v_profile.region_state) then
    raise exception 'REGION_BLOCKED: Penny Pincher cash games are currently unavailable in your region.';
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

  v_top_up_window_last_round := coalesce(v_game.reup_cutoff_round, 30);

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

-- admin_create_game: staff can now set poker-style min/max buy-in (tokens) and
-- the re-up cutoff round when creating a tournament. Nulls for min/max mean no
-- limit (unchanged default behavior).
drop function if exists public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean);
create or replace function public.admin_create_game(
  p_mode public.game_mode default 'original_escalator',
  p_payout_scheme public.payout_scheme default 'standard',
  p_round_seconds int default 12,
  p_auto_approve boolean default false,
  p_min_buy_in_tokens int default null,
  p_max_buy_in_tokens int default null,
  p_reup_cutoff_round int default 30)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_secs int := least(greatest(coalesce(p_round_seconds, 12), 5), 60);
  v_status text := case when p_auto_approve then 'pending' else 'draft' end;
  v_cutoff int := least(greatest(coalesce(p_reup_cutoff_round, 30), 1), 100);
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
        reup_cutoff_round = v_cutoff
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
      'reupCutoffRound', v_cutoff));
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean, int, int, int) from public, anon;
grant execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean, int, int, int) to authenticated;
