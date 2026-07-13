-- Percentage-based payouts for large fields. The fixed "top 10" cap gave absurd
-- win rates in big games (0.1% at 10k players). Now:
--   * Small fields (< 40): explicit tiers — < 15 = top 3 (50/30/20), 15–39 = top 5.
--   * Large fields (>= 40): pay ~the TOP 10% of the field (minimum 10 places). The top
--     10 share 60% of the pool on a decaying curve (a strong podium/headline prize);
--     the remaining paid places split the other 40% equally (a flat min-cash tail).
--     Because the pool averages ~6x avg spend per paid place, the flat tail lands
--     comfortably above a typical entry, so a top-10% finish always cashes real money.
--
-- Supersedes the fixed payout_tiers table from 20260707014000.

drop function if exists public.game_payout_summary(uuid);
drop function if exists public.payout_tiers_for(int);
drop table if exists public.payout_tiers cascade;

-- Number of paid places for a given eligible field size.
create or replace function public.payout_places_for(p_field int)
returns int
language sql immutable
as $$
  select case
    when p_field <= 0 then 0
    when p_field < 15 then least(3, p_field)
    when p_field < 40 then least(5, p_field)
    else least(greatest(round(p_field * 0.10)::int, 10), p_field)
  end;
$$;

-- Exact per-place payout (in cents) for a pool and field size; array sums to p_pool.
create or replace function public.compute_payout_shares(p_pool int, p_field int)
returns int[]
language plpgsql immutable
as $$
declare
  v_shares int[] := '{}';
  v_curve int[] := array[28,18,13,10,8,7,6,4,3,3]; -- top-10 podium curve (sums 100)
  v_paid int;
  v_podium int;
  v_podium_pool int;
  v_tail_pool int;
  v_tail int;
  v_tail_each int;
  v_dist int := 0;
  v_i int;
  v_share int;
  v_small int[];
begin
  if p_field <= 0 or p_pool <= 0 then
    return '{}';
  end if;

  -- Small fields: explicit tiers take the whole pool.
  if p_field < 40 then
    if p_field < 15 then v_small := array[50,30,20]; else v_small := array[40,24,16,12,8]; end if;
    v_paid := least(array_length(v_small, 1), p_field);
    for v_i in 1..v_paid loop
      if v_i < v_paid then v_share := round(p_pool * v_small[v_i] / 100.0); else v_share := p_pool - v_dist; end if;
      v_dist := v_dist + v_share;
      v_shares := v_shares || v_share;
    end loop;
    return v_shares;
  end if;

  -- Large fields: top ~10% (min 10).
  v_paid := least(greatest(round(p_field * 0.10)::int, 10), p_field);
  v_podium := least(10, v_paid); -- 10 here, since v_paid >= 10
  v_tail := v_paid - v_podium;

  if v_tail = 0 then
    -- Exactly 10 paid: whole pool on the curve.
    for v_i in 1..v_podium loop
      if v_i < v_podium then v_share := round(p_pool * v_curve[v_i] / 100.0); else v_share := p_pool - v_dist; end if;
      v_dist := v_dist + v_share;
      v_shares := v_shares || v_share;
    end loop;
    return v_shares;
  end if;

  v_podium_pool := round(p_pool * 0.60);
  v_tail_pool := p_pool - v_podium_pool;

  -- Podium (top 10): 60% of pool via the curve; place 10 absorbs podium rounding.
  for v_i in 1..v_podium loop
    if v_i < v_podium then v_share := round(v_podium_pool * v_curve[v_i] / 100.0); else v_share := v_podium_pool - v_dist; end if;
    v_dist := v_dist + v_share;
    v_shares := v_shares || v_share;
  end loop;

  -- Flat tail: remaining places split 40% equally; last place absorbs the remainder.
  v_tail_each := v_tail_pool / v_tail; -- integer division
  for v_i in 1..v_tail loop
    if v_i < v_tail then v_share := v_tail_each; else v_share := v_tail_pool - v_tail_each * (v_tail - 1); end if;
    v_shares := v_shares || v_share;
  end loop;

  return v_shares;
end;
$$;

-- Transparency helper ("pays top N"); placesPaid depends only on field size.
create or replace function public.game_payout_summary(p_game_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with f as (
    select count(*)::int as field_size
    from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
  )
  select jsonb_build_object(
    'eligiblePlayers', f.field_size,
    'placesPaid', public.payout_places_for(f.field_size),
    'payFractionPct', case when f.field_size >= 40 then 10 else null end
  )
  from f;
$$;
revoke execute on function public.game_payout_summary(uuid) from public, anon;
grant execute on function public.game_payout_summary(uuid) to authenticated;


-- payout_game: distribute via compute_payout_shares. Ranking/tie-break unchanged;
-- Sudden Death Overtime triggers on a true dead heat anywhere in the paid places.
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

  v_shares := public.compute_payout_shares(v_game.total_prize_pool_cents, v_field);
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
    'fieldSize', v_field,
    'placesPaid', v_paid_places,
    'payouts', v_payouts
  );
end;
$$;
