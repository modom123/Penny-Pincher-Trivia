-- Go-live enforcement: withdrawal gated by KYC (verified + 18+) and tax
-- threshold; buy-in gated by geo-fence; payout tracks lifetime winnings;
-- submit_answer writes the black-box log. Plus supporting player/service/staff RPCs.

-- reserve_withdrawal, gated by KYC and tax threshold.
create or replace function public.reserve_withdrawal(p_amount_cents int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_p record;
  v_ledger_id uuid;
  v_tax_lock_cents constant int := 55000; -- $550, locks before the $600 1099 threshold
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'cents must be a positive integer';
  end if;

  select wallet_balance_cents, stripe_connect_account_id, kyc_status, date_of_birth,
         lifetime_winnings_cents, tax_details_confirmed
  into v_p
  from public.profiles where user_id = v_user_id for update;

  -- KYC gate: identity verified + 18+ before ANY money leaves the app.
  if v_p.kyc_status <> 'verified' then
    raise exception 'KYC_REQUIRED: Identity verification is required before withdrawing.';
  end if;
  if v_p.date_of_birth is null or v_p.date_of_birth > (current_date - interval '18 years') then
    raise exception 'AGE_REQUIREMENT: You must be at least 18 years old to withdraw.';
  end if;

  -- Tax gate: near the federal 1099 threshold, block until W-9/tax details collected.
  if v_p.lifetime_winnings_cents >= v_tax_lock_cents and not v_p.tax_details_confirmed then
    raise exception 'TAX_DETAILS_REQUIRED: You are approaching the federal tax reporting threshold. Please confirm your tax details to continue cashing out.';
  end if;

  if v_p.stripe_connect_account_id is null then
    raise exception 'Stripe Connect account not linked. Complete onboarding first.';
  end if;
  if v_p.wallet_balance_cents < p_amount_cents then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents - p_amount_cents
  where user_id = v_user_id;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (v_user_id, 'withdrawal', -p_amount_cents, 'pending')
  returning id into v_ledger_id;

  return jsonb_build_object('ledgerId', v_ledger_id, 'connectAccountId', v_p.stripe_connect_account_id, 'amountCents', p_amount_cents);
end;
$$;


-- buy_round, with geo-fence enforcement. Reads admin-editable blocked_states from
-- platform_config, compared against the player's last verified region (set by the
-- geo-check edge function from a Radar.io/GeoComply device ping).
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

  -- Geo-fence: block buy-ins from restricted states. A null region_state (location
  -- never verified) is also blocked - a real-money buy-in needs a confirmed location.
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

  if v_round_cost > 0 and v_profile.wallet_balance_cents < v_round_cost then
    raise exception 'Insufficient tokens in wallet for this round';
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


-- payout_game now also increments lifetime_winnings_cents for the tax threshold.
create or replace function public.payout_game(p_game_id uuid)
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
  v_tied_ranks int[];
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

  select array_agg(distinct rnk) into v_tied_ranks
  from (
    select user_id, rank() over (order by total_score desc) as rnk
    from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
  ) ranked
  where rnk <= 3
  group by rnk
  having count(*) > 1;

  if v_tied_ranks is not null then
    delete from public.sudden_death_participants where game_id = p_game_id;
    insert into public.sudden_death_participants (game_id, user_id, contested_place_start, contested_place_end)
    select p_game_id, ranked.user_id, ranked.rnk, ranked.rnk
    from (
      select user_id, rank() over (order by total_score desc) as rnk
      from public.player_game_stats
      where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    ) ranked
    where ranked.rnk = any(v_tied_ranks);
    update public.games set in_sudden_death = true where game_id = p_game_id;
    return jsonb_build_object(
      'status', 'sudden_death', 'gameId', p_game_id, 'tiedRanks', v_tied_ranks,
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'contestedPlace', contested_place_start)), '[]'::jsonb)
        from public.sudden_death_participants where game_id = p_game_id
      )
    );
  end if;

  for v_winner in
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    order by total_score desc limit 3
  loop
    v_place := v_place + 1;
    v_share := case
      when v_place = least((select count(*) from public.player_game_stats where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false), 3)
        then v_game.total_prize_pool_cents - v_distributed
      when v_place = 1 then round(v_game.total_prize_pool_cents * 0.5)
      when v_place = 2 then round(v_game.total_prize_pool_cents * 0.3)
      else round(v_game.total_prize_pool_cents * 0.2)
    end;
    v_distributed := v_distributed + v_share;

    update public.profiles
    set wallet_balance_cents = wallet_balance_cents + v_share,
        lifetime_winnings_cents = lifetime_winnings_cents + v_share
    where user_id = v_winner.user_id;

    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_winner.user_id, 'payout', v_share, p_game_id);

    v_payouts := v_payouts || jsonb_build_object(
      'userId', v_winner.user_id, 'place', v_place, 'amountCents', v_share, 'totalScore', v_winner.total_score
    );
  end loop;

  update public.games set status = 'completed', completed_at = now(), in_sudden_death = false where game_id = p_game_id;
  delete from public.sudden_death_participants where game_id = p_game_id;

  return jsonb_build_object(
    'status', 'completed', 'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'payouts', v_payouts
  );
end;
$$;


-- submit_answer now writes accepted/rejected events to the black-box ledger with
-- the authoritative server-observed timing (for dispute adjudication).
create or replace function public.submit_answer(p_game_id uuid, p_round_number int, p_selected_option varchar)
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
  v_high_value_round_threshold constant int := 80;
  v_high_value_reaction_ms constant int := 150;
  v_disqualify_after_flags constant int := 3;
  v_disqualify_after_high_value_flags constant int := 2;
  v_entry record;
  v_is_correct boolean;
  v_points int;
  v_answer_id uuid;
  v_flag_count int;
  v_high_value_flag_count int;
  v_cheat_flagged boolean := false;
  v_flag_reason varchar;
  v_rejected_reason varchar;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select gr.round_number, gr.started_at, gr.ended_at, gr.is_overtime, q.correct_option, q.time_limit_seconds
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

  v_time_taken_ms := extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000;

  if v_round.ended_at is not null then
    v_rejected_reason := 'round_already_closed';
  elsif v_time_taken_ms > v_round.time_limit_seconds * 1000 + v_grace_ms then
    v_rejected_reason := 'past_cutoff';
  end if;

  if v_rejected_reason is not null then
    insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
    values (v_user_id, p_game_id, p_round_number, 'answer_rejected', v_time_taken_ms,
            jsonb_build_object('reason', v_rejected_reason, 'timeLimitSeconds', v_round.time_limit_seconds));
    if v_rejected_reason = 'round_already_closed' then
      raise exception 'This round is not currently accepting answers';
    else
      raise exception 'Answer rejected: submitted after the round closed';
    end if;
  end if;

  if v_round.is_overtime then
    if not exists (select 1 from public.sudden_death_participants where game_id = p_game_id and user_id = v_user_id) then
      raise exception 'Not eligible for sudden death overtime';
    end if;
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

  insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
  values (v_user_id, p_game_id, p_round_number, 'answer_accepted', v_time_taken_ms,
          jsonb_build_object('isCorrect', v_is_correct, 'pointsAwarded', v_points));

  if p_round_number >= v_high_value_round_threshold and v_time_taken_ms < v_high_value_reaction_ms then
    v_cheat_flagged := true;
    v_flag_reason := 'input_velocity_too_fast_high_value_round';
  elsif v_time_taken_ms < v_min_human_reaction_ms then
    v_cheat_flagged := true;
    v_flag_reason := 'input_velocity_too_fast';
  end if;

  if v_cheat_flagged then
    insert into public.cheat_flags (user_id, game_id, round_number, reason)
    values (v_user_id, p_game_id, p_round_number, v_flag_reason);

    select count(*) into v_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id;
    select count(*) into v_high_value_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id and reason = 'input_velocity_too_fast_high_value_round';

    if v_flag_count >= v_disqualify_after_flags or v_high_value_flag_count >= v_disqualify_after_high_value_flags then
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


-- ── Supporting RPCs ──────────────────────────────────────────────────────────

-- Player: confirm tax details (after Stripe Tax's hosted W-9 flow).
create function public.confirm_tax_details()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.profiles set tax_details_confirmed = true where user_id = auth.uid();
end;
$$;
revoke execute on function public.confirm_tax_details() from public, anon;
grant execute on function public.confirm_tax_details() to authenticated;

-- Player: own compliance status, so the wallet UI shows the right gate.
create function public.my_compliance_status()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_p record; v_blocked jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select kyc_status, date_of_birth, lifetime_winnings_cents, tax_details_confirmed,
         region_state, wallet_balance_cents
  into v_p from public.profiles where user_id = auth.uid();
  select value into v_blocked from public.platform_config where key = 'blocked_states';
  return jsonb_build_object(
    'kycStatus', v_p.kyc_status,
    'isAdult', v_p.date_of_birth is not null and v_p.date_of_birth <= (current_date - interval '18 years'),
    'lifetimeWinningsCents', v_p.lifetime_winnings_cents,
    'taxDetailsConfirmed', v_p.tax_details_confirmed,
    'taxThresholdCents', 55000,
    'regionState', v_p.region_state,
    'regionBlocked', v_p.region_state is not null and (v_blocked ? v_p.region_state),
    'walletBalanceCents', v_p.wallet_balance_cents
  );
end;
$$;
revoke execute on function public.my_compliance_status() from public, anon;
grant execute on function public.my_compliance_status() to authenticated;

-- Player: append a black-box log event (taps, pings, disconnects). server_received_at
-- is the DB default (authoritative); client_timestamp_ms is stored for comparison only.
create function public.log_client_event(
  p_game_id uuid, p_round_number int, p_event_type varchar, p_client_timestamp_ms bigint, p_detail jsonb default null
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  insert into public.websocket_logs (user_id, game_id, round_number, event_type, client_timestamp_ms, detail)
  values (auth.uid(), p_game_id, p_round_number, p_event_type, p_client_timestamp_ms, p_detail);
end;
$$;
revoke execute on function public.log_client_event(uuid, int, varchar, bigint, jsonb) from public, anon;
grant execute on function public.log_client_event(uuid, int, varchar, bigint, jsonb) to authenticated;

-- Service-role: KYC webhook applies a verification result (Persona/Stripe Identity).
create function public.apply_kyc_result(p_user_id uuid, p_status varchar, p_provider_ref varchar, p_date_of_birth date)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set
    kyc_status = p_status,
    kyc_provider_ref = coalesce(p_provider_ref, kyc_provider_ref),
    date_of_birth = coalesce(p_date_of_birth, date_of_birth),
    kyc_verified_at = case when p_status = 'verified' then now() else kyc_verified_at end
  where user_id = p_user_id;
end;
$$;
revoke execute on function public.apply_kyc_result(uuid, varchar, varchar, date) from public, anon, authenticated;
grant execute on function public.apply_kyc_result(uuid, varchar, varchar, date) to service_role;

-- Service-role: geo-check edge function sets the player's verified region.
create function public.set_verified_region(p_user_id uuid, p_state varchar, p_country varchar)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.profiles set
    region_state = p_state, region_country = coalesce(p_country, 'US'), region_verified_at = now()
  where user_id = p_user_id;
end;
$$;
revoke execute on function public.set_verified_region(uuid, varchar, varchar) from public, anon, authenticated;
grant execute on function public.set_verified_region(uuid, varchar, varchar) to service_role;

-- Service-role: 48h retention purge for the black-box ledger (call from a scheduled job).
create function public.purge_old_websocket_logs()
returns int
language plpgsql security definer set search_path = public
as $$
declare v_deleted int;
begin
  delete from public.websocket_logs where server_received_at < now() - interval '48 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke execute on function public.purge_old_websocket_logs() from public, anon, authenticated;
grant execute on function public.purge_old_websocket_logs() to service_role;

-- Staff (support/compliance): pull a player's black-box log to adjudicate a dispute.
create function public.staff_get_player_log(p_user_id uuid, p_limit int default 100)
returns setof public.websocket_logs
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;
  return query
    select * from public.websocket_logs where user_id = p_user_id
    order by server_received_at desc limit least(p_limit, 500);
end;
$$;
revoke execute on function public.staff_get_player_log(uuid, int) from public, anon;
grant execute on function public.staff_get_player_log(uuid, int) to authenticated;
