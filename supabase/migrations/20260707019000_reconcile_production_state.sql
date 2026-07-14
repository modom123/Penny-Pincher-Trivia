-- Reconciliation: capture production state that had drifted from the repo.
--
-- Several features were applied to the live database via direct SQL and never
-- landed in repo migrations, so a fresh `db reset` from the repo would NOT
-- reproduce production. This migration codifies that drift so the repo faithfully
-- rebuilds prod. It is written idempotently (IF NOT EXISTS / CREATE OR REPLACE)
-- and is already reflected in production, so applying it there is a no-op.
--
-- Captured here (confirmed absent from repo migrations):
--   * payout_scheme: enum + games.payout_scheme column + the payout engine
--     (payout_places_for / compute_payout_shares / game_payout_summary /
--     payout_game / admin_create_game) that selects a per-game payout curve.
--   * skip system: games.max_skips + player_game_stats.skips_used + skip_round(),
--     a dedicated "pass this round" RPC (replaces the old SKIP-in-submit_answer).
--   * submit_answer: production version (wrong-answer penalty, streak risk
--     premium, high-value-round velocity checks, black-box logging) with the old
--     SKIP handling removed.
--
-- NOTE: start_round's milestone change and the Milestone Booster redesign are
-- handled in the following migration, not here.

-- ---------------------------------------------------------------------------
-- Schema: payout_scheme enum + columns
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where t.typname='payout_scheme' and n.nspname='public') then
    create type public.payout_scheme as enum
      ('standard','classic_top3','winner_take_most','spread_the_wealth');
  end if;
end $$;

alter table public.games
  add column if not exists payout_scheme public.payout_scheme not null default 'standard';
alter table public.games
  add column if not exists max_skips int not null default 3;
alter table public.player_game_stats
  add column if not exists skips_used int not null default 0;

-- ---------------------------------------------------------------------------
-- Payout engine (payout_scheme-aware)
-- ---------------------------------------------------------------------------
create or replace function public.payout_places_for(p_field integer, p_scheme payout_scheme default 'standard')
returns integer language sql immutable as $function$
  select case
    when p_field <= 0 then 0
    when p_scheme = 'classic_top3' then least(3, p_field)
    when p_scheme = 'winner_take_most' then least(3, p_field)
    when p_scheme = 'spread_the_wealth' then least(p_field, greatest(round(p_field * 0.25)::int, 5))
    else -- standard
      case
        when p_field < 15 then least(3, p_field)
        when p_field < 40 then least(5, p_field)
        else least(greatest(round(p_field * 0.10)::int, 10), p_field)
      end
  end;
$function$;

create or replace function public.compute_payout_shares(p_pool integer, p_field integer, p_scheme payout_scheme default 'standard')
returns integer[] language plpgsql immutable as $function$
declare
  v_shares int[] := '{}';
  v_paid int;
  v_weights numeric[] := '{}';
  v_sumw numeric := 0;
  v_dist int := 0;
  v_i int;
  v_share int;
  v_curve int[] := array[28,18,13,10,8,7,6,4,3,3]; -- standard large-field podium curve
  v_podium int; v_tail int; v_podium_pool int; v_tail_pool int; v_tail_each int;
begin
  if p_pool <= 0 or p_field <= 0 then return '{}'; end if;
  v_paid := public.payout_places_for(p_field, p_scheme);
  if v_paid <= 0 then return '{}'; end if;

  -- Weight-based schemes (classic / winner-take-most / spread): build a weight
  -- array, then hand the pool out proportionally with the last place absorbing
  -- any rounding remainder so the array sums to exactly p_pool.
  if p_scheme = 'classic_top3' then
    v_weights := (array[50,30,20])[1:v_paid]::numeric[];
  elsif p_scheme = 'winner_take_most' then
    v_weights := (array[70,20,10])[1:v_paid]::numeric[];
  elsif p_scheme = 'spread_the_wealth' then
    for v_i in 1..v_paid loop v_weights := v_weights || (v_paid - v_i + 3)::numeric; end loop;
  end if;

  if array_length(v_weights, 1) is not null then
    select sum(w) into v_sumw from unnest(v_weights) w;
    for v_i in 1..v_paid loop
      if v_i < v_paid then v_share := round(p_pool * v_weights[v_i] / v_sumw); else v_share := p_pool - v_dist; end if;
      v_dist := v_dist + v_share;
      v_shares := v_shares || v_share;
    end loop;
    return v_shares;
  end if;

  -- standard scheme --------------------------------------------------------
  if p_field < 40 then
    declare v_small int[];
    begin
      if p_field < 15 then v_small := array[50,30,20]; else v_small := array[40,24,16,12,8]; end if;
      v_paid := least(array_length(v_small, 1), p_field);
      for v_i in 1..v_paid loop
        if v_i < v_paid then v_share := round(p_pool * v_small[v_i] / 100.0); else v_share := p_pool - v_dist; end if;
        v_dist := v_dist + v_share; v_shares := v_shares || v_share;
      end loop;
      return v_shares;
    end;
  end if;

  v_podium := least(10, v_paid);
  v_tail := v_paid - v_podium;
  if v_tail = 0 then
    for v_i in 1..v_podium loop
      if v_i < v_podium then v_share := round(p_pool * v_curve[v_i] / 100.0); else v_share := p_pool - v_dist; end if;
      v_dist := v_dist + v_share; v_shares := v_shares || v_share;
    end loop;
    return v_shares;
  end if;

  v_podium_pool := round(p_pool * 0.60);
  v_tail_pool := p_pool - v_podium_pool;
  for v_i in 1..v_podium loop
    if v_i < v_podium then v_share := round(v_podium_pool * v_curve[v_i] / 100.0); else v_share := v_podium_pool - v_dist; end if;
    v_dist := v_dist + v_share; v_shares := v_shares || v_share;
  end loop;
  v_tail_each := v_tail_pool / v_tail;
  for v_i in 1..v_tail loop
    if v_i < v_tail then v_share := v_tail_each; else v_share := v_tail_pool - v_tail_each * (v_tail - 1); end if;
    v_shares := v_shares || v_share;
  end loop;
  return v_shares;
end;
$function$;

create or replace function public.game_payout_summary(p_game_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with g as (select payout_scheme from public.games where game_id = p_game_id),
  f as (
    select count(*)::int as field_size
    from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
  )
  select jsonb_build_object(
    'scheme', g.payout_scheme,
    'eligiblePlayers', f.field_size,
    'placesPaid', public.payout_places_for(f.field_size, g.payout_scheme)
  )
  from g, f;
$function$;
revoke execute on function public.game_payout_summary(uuid) from public, anon;
grant execute on function public.game_payout_summary(uuid) to authenticated;

create or replace function public.payout_game(p_game_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_game record;
  v_winner record;
  v_place int := 0;
  v_share int;
  v_payouts jsonb := '[]'::jsonb;
  v_tied_ranks int[];
  v_field int;
  v_shares int[];
  v_paid_places int;
begin
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status = 'completed' then raise exception 'Game already paid out'; end if;
  if v_game.current_round < v_game.total_rounds then
    raise exception 'Game has not reached its final round yet (%/%)', v_game.current_round, v_game.total_rounds;
  end if;

  select count(*) into v_field
  from public.player_game_stats
  where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false;

  v_shares := public.compute_payout_shares(v_game.total_prize_pool_cents, v_field, v_game.payout_scheme);
  v_paid_places := coalesce(array_length(v_shares, 1), 0);

  select array_agg(distinct rnk) into v_tied_ranks
  from (
    select user_id, rank() over (order by total_score desc, total_cash_spent_cents asc) as rnk
    from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
  ) ranked
  where rnk <= v_paid_places
  group by rnk
  having count(*) > 1;

  if v_tied_ranks is not null then
    delete from public.sudden_death_participants where game_id = p_game_id;
    insert into public.sudden_death_participants (game_id, user_id, contested_place_start, contested_place_end)
    select p_game_id, ranked.user_id, ranked.rnk, ranked.rnk
    from (
      select user_id, rank() over (order by total_score desc, total_cash_spent_cents asc) as rnk
      from public.player_game_stats
      where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    ) ranked
    where ranked.rnk = any(v_tied_ranks);
    update public.games set in_sudden_death = true where game_id = p_game_id;
    return jsonb_build_object(
      'status', 'sudden_death', 'gameId', p_game_id, 'tiedRanks', v_tied_ranks,
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'userId', sdp.user_id, 'username', pr.username, 'contestedPlace', sdp.contested_place_start)), '[]'::jsonb)
        from public.sudden_death_participants sdp
        join public.profiles pr on pr.user_id = sdp.user_id
        where sdp.game_id = p_game_id
      )
    );
  end if;

  for v_winner in
    select pgs.user_id, pgs.total_score, pr.username
    from public.player_game_stats pgs
    join public.profiles pr on pr.user_id = pgs.user_id
    where pgs.game_id = p_game_id and pgs.is_eligible_for_grand_prize = true and pgs.is_eliminated = false
    order by pgs.total_score desc, pgs.total_cash_spent_cents asc
    limit v_paid_places
  loop
    v_place := v_place + 1;
    v_share := v_shares[v_place];
    update public.profiles
    set wallet_balance_cents = wallet_balance_cents + v_share,
        lifetime_winnings_cents = lifetime_winnings_cents + v_share
    where user_id = v_winner.user_id;
    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_winner.user_id, 'payout', v_share, p_game_id);
    v_payouts := v_payouts || jsonb_build_object(
      'userId', v_winner.user_id, 'username', v_winner.username,
      'place', v_place, 'amountCents', v_share, 'totalScore', v_winner.total_score
    );
  end loop;

  update public.games set status = 'completed', completed_at = now(), in_sudden_death = false where game_id = p_game_id;
  delete from public.sudden_death_participants where game_id = p_game_id;

  return jsonb_build_object(
    'status', 'completed', 'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'fieldSize', v_field, 'placesPaid', v_paid_places,
    'payoutScheme', v_game.payout_scheme, 'payouts', v_payouts
  );
end;
$function$;
revoke execute on function public.payout_game(uuid) from public, anon, authenticated;
grant execute on function public.payout_game(uuid) to service_role;

create or replace function public.admin_create_game(p_mode game_mode default 'original_escalator', p_payout_scheme payout_scheme default 'standard')
returns games language plpgsql security definer set search_path to 'public' as $function$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  v_game := public.create_game(p_mode);
  update public.games set payout_scheme = p_payout_scheme where game_id = v_game.game_id
    returning * into v_game;
  perform public.log_admin_action('create_game', null, v_game.game_id,
    jsonb_build_object('mode', p_mode, 'payoutScheme', p_payout_scheme));
  return v_game;
end;
$function$;
revoke execute on function public.admin_create_game(game_mode, payout_scheme) from public, anon;
grant execute on function public.admin_create_game(game_mode, payout_scheme) to authenticated;

-- ---------------------------------------------------------------------------
-- Skip system: dedicated skip_round() RPC + submit_answer (SKIP removed)
-- ---------------------------------------------------------------------------
create or replace function public.skip_round(p_game_id uuid, p_round_number integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_max_skips int;
  v_used int;
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
$function$;
revoke execute on function public.skip_round(uuid, integer) from public, anon;
grant execute on function public.skip_round(uuid, integer) to authenticated;

create or replace function public.submit_answer(p_game_id uuid, p_round_number integer, p_selected_option character varying)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_game_mode public.game_mode;
  v_time_taken_ms int;
  v_grace_ms constant int := 500;
  v_min_human_reaction_ms constant int := 300;
  v_high_value_round_threshold constant int := 80;
  v_high_value_reaction_ms constant int := 150;
  v_disqualify_after_flags constant int := 3;
  v_disqualify_after_high_value_flags constant int := 2;
  v_risk_premium constant numeric := 1.5;
  v_entry record;
  v_is_correct boolean;
  v_base_points int;
  v_points int;
  v_round_was_paid boolean;
  v_new_total int;
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

  select gr.round_number, gr.started_at, gr.ended_at, gr.is_overtime, q.correct_option, q.time_limit_seconds, g.mode
  into v_round
  from public.game_rounds gr
  join public.questions q using (question_id)
  join public.games g on g.game_id = gr.game_id
  where gr.game_id = p_game_id and gr.round_number = p_round_number
  for update of gr;
  if not found then
    raise exception 'Round not found for this game';
  end if;
  v_game_mode := v_round.mode;
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

  -- Did the player pay real cash to enter this round? (streak-free rounds cost 0)
  select coalesce(sum(-amount_cents), 0) > 0 into v_round_was_paid
  from public.wallet_ledger
  where user_id = v_user_id and game_id = p_game_id and round_number = p_round_number and entry_type = 'round_debit';

  v_is_correct := p_selected_option = v_round.correct_option;
  v_base_points := p_round_number * 10;

  if v_is_correct then
    -- Risk premium: paid rounds in streak_saver earn 1.5x base (capital on the line).
    if v_game_mode = 'streak_saver' and v_round_was_paid then
      v_points := round(v_base_points * v_risk_premium)::int + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0);
    else
      v_points := v_base_points + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0);
    end if;
  else
    v_points := -v_base_points;
  end if;

  insert into public.player_answers
    (user_id, game_id, round_number, question_id, selected_option, is_correct, time_taken_ms, points_awarded)
  select v_user_id, p_game_id, p_round_number, gr.question_id, p_selected_option, v_is_correct, v_time_taken_ms::int, v_points
  from public.game_rounds gr where gr.game_id = p_game_id and gr.round_number = p_round_number
  on conflict (user_id, game_id, round_number) do nothing
  returning id into v_answer_id;
  if v_answer_id is null then
    raise exception 'You already answered this round';
  end if;

  update public.player_game_stats
  set total_score = greatest(total_score + v_points, 0),
      total_response_time_ms = total_response_time_ms + v_time_taken_ms
  where user_id = v_user_id and game_id = p_game_id
  returning total_score into v_new_total;

  insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
  values (v_user_id, p_game_id, p_round_number, 'answer_accepted', v_time_taken_ms,
          jsonb_build_object('isCorrect', v_is_correct, 'pointsAwarded', v_points, 'newTotalScore', v_new_total,
                             'riskPremiumApplied', v_is_correct and v_game_mode = 'streak_saver' and v_round_was_paid));

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
    'newTotalScore', v_new_total,
    'riskPremiumApplied', v_is_correct and v_game_mode = 'streak_saver' and v_round_was_paid,
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$function$;
revoke execute on function public.submit_answer(uuid, integer, character varying) from public, anon;
grant execute on function public.submit_answer(uuid, integer, character varying) to authenticated;
