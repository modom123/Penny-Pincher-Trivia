-- Two go-live audit fixes (docs/GO-LIVE-AUDIT-2026-07-23.md, Gates A & D):
--
-- 1. ZERO-WINNER POOL REFUND. payout_game previously marked a game 'completed'
--    even when no player was eligible to win, paying nobody and stranding the
--    prize pool in games.total_prize_pool_cents. The pool is player money; it
--    now refunds pro-rata to each player's cash contribution (the pool is
--    funded exclusively by the cash portion of buy-ins, so refunds credit the
--    withdrawable cash balance). This is the minimum-safe behaviour; the
--    clearance package's §3.11 weekly rollover design may replace it after
--    counsel weighs in, at which point this branch becomes the fallback.
--
-- 2. GEOFENCE PRODUCTION LOCK. admin_update_geofence_enabled(false) let any
--    single admin/compliance account disable ALL location checks at runtime.
--    admin_lock_geofence() now sets a one-way production lock: while locked,
--    geofencing is forced on and cannot be disabled from the Command Center.
--    There is deliberately NO unlock function granted to authenticated users -
--    unlocking requires service-role SQL, so a lone compromised or careless
--    staff login can no longer turn the geofence off.

-- ---------------------------------------------------------------------------
-- 1. payout_game: refund the pool when the game ends with zero eligible winners
-- ---------------------------------------------------------------------------

create or replace function public.payout_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
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
  -- zero-winner refund locals
  v_pool int;
  v_total_cash bigint;
  v_refunds jsonb := '[]'::jsonb;
  v_refunded int := 0;
  v_n int;
  v_i int := 0;
  v_r record;
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

  -- Zero eligible winners: the pool must not be stranded. Refund it pro-rata to
  -- everyone who funded it (by cash spent in this game); the largest contributor
  -- is processed last and absorbs the rounding remainder, so refunds sum exactly
  -- to the pool.
  if v_field = 0 then
    v_pool := v_game.total_prize_pool_cents;

    if v_pool > 0 then
      select coalesce(sum(total_cash_spent_cents), 0), count(*) into v_total_cash, v_n
      from public.player_game_stats
      where game_id = p_game_id and total_cash_spent_cents > 0;

      if v_total_cash > 0 then
        for v_r in
          select pgs.user_id, pgs.total_cash_spent_cents, pr.username
          from public.player_game_stats pgs
          join public.profiles pr on pr.user_id = pgs.user_id
          where pgs.game_id = p_game_id and pgs.total_cash_spent_cents > 0
          order by pgs.total_cash_spent_cents asc, pgs.user_id
        loop
          v_i := v_i + 1;
          if v_i = v_n then
            v_share := v_pool - v_refunded; -- largest contributor absorbs rounding
          else
            v_share := floor(v_pool::numeric * v_r.total_cash_spent_cents / v_total_cash)::int;
          end if;

          if v_share > 0 then
            -- Cash-funded pool -> refund is withdrawable cash (promo untouched).
            -- Not winnings: lifetime_winnings_cents is deliberately NOT incremented.
            update public.profiles
            set wallet_balance_cents = wallet_balance_cents + v_share
            where user_id = v_r.user_id;
            insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
            values (v_r.user_id, 'pool_refund', v_share, p_game_id);
          end if;
          v_refunded := v_refunded + v_share;
          v_refunds := v_refunds || jsonb_build_object(
            'userId', v_r.user_id, 'username', v_r.username, 'amountCents', v_share
          );
        end loop;
      else
        -- Defensive: a funded pool with no cash contributors should be impossible
        -- (the pool is built from v_cash_used). Sweep to house revenue rather
        -- than strand it, and surface the anomaly in the result.
        update public.games
        set admin_revenue_pool_cents = admin_revenue_pool_cents + v_pool
        where game_id = p_game_id;
      end if;
    end if;

    update public.games
    set status = 'completed', completed_at = now(), in_sudden_death = false,
        total_prize_pool_cents = 0
    where game_id = p_game_id
    returning * into v_game;
    delete from public.sudden_death_participants where game_id = p_game_id;

    return jsonb_build_object(
      'status', 'completed', 'gameId', p_game_id,
      'outcome', 'no_eligible_winners_pool_refunded',
      'poolRefundedCents', v_refunded,
      'refunds', v_refunds,
      'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
      'fieldSize', 0, 'placesPaid', 0,
      'payoutScheme', v_game.payout_scheme, 'payouts', '[]'::jsonb
    );
  end if;

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
$$;

-- ---------------------------------------------------------------------------
-- 2. Geofence production lock (one-way from the Command Center)
-- ---------------------------------------------------------------------------

-- admin_lock_geofence: sets the lock AND forces geofencing on. Admin role only.
create or replace function public.admin_lock_geofence()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin']) then
    raise exception 'Forbidden: admin access required';
  end if;

  insert into public.platform_config (key, value)
  values ('geofence_production_lock', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();

  insert into public.platform_config (key, value)
  values ('geofence_enabled', 'true'::jsonb)
  on conflict (key) do update set value = 'true'::jsonb, updated_at = now();

  perform public.log_admin_action('lock_geofence_production', null, null,
    jsonb_build_object('locked', true, 'geofenceForcedOn', true));
end;
$$;
revoke execute on function public.admin_lock_geofence() from public, anon;
grant execute on function public.admin_lock_geofence() to authenticated;

-- NOTE: no unlock counterpart is defined for authenticated users, on purpose.
-- Unlocking requires service-role SQL:
--   update public.platform_config set value = 'false'::jsonb
--   where key = 'geofence_production_lock';

-- admin_update_geofence_enabled: refuse to disable while production-locked.
create or replace function public.admin_update_geofence_enabled(p_enabled boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_locked boolean;
begin
  if not public.is_staff(array['admin','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;

  if not p_enabled then
    select coalesce((value)::boolean, false) into v_locked
    from public.platform_config where key = 'geofence_production_lock';
    if coalesce(v_locked, false) then
      raise exception 'GEOFENCE_LOCKED: Geofencing is production-locked and cannot be disabled from the Command Center. Unlocking requires direct database (service-role) access.';
    end if;
  end if;

  insert into public.platform_config (key, value)
  values ('geofence_enabled', to_jsonb(p_enabled))
  on conflict (key) do update set value = to_jsonb(p_enabled), updated_at = now();

  perform public.log_admin_action('update_geofence_enabled', null, null, jsonb_build_object('enabled', p_enabled));
end;
$$;
revoke execute on function public.admin_update_geofence_enabled(boolean) from public, anon;
grant execute on function public.admin_update_geofence_enabled(boolean) to authenticated;
