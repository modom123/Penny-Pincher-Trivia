-- Selectable payout schemes per game, for variety/excitement. Each game carries
-- a payout_scheme; payout_game distributes the pool according to it. Ranking and
-- tie-break are unchanged — only how the pool is SPLIT across the ranked field.
--
--   standard          — field-scaled (default): <15 top 3 (50/30/20), 15-39 top 5,
--                       40+ ~top 10% (decaying podium + flat min-cash tail).
--   classic_top3      — always the top 3 at 50/30/20, any field size.
--   winner_take_most  — top-heavy: top 3 at 70/20/10 (big headline prize).
--   spread_the_wealth — many winners: pays ~top 25% (min 5) on a gentle decay.

create type public.payout_scheme as enum
  ('standard', 'classic_top3', 'winner_take_most', 'spread_the_wealth');

alter table public.games
  add column if not exists payout_scheme public.payout_scheme not null default 'standard';

-- Number of paid places for a field size under a given scheme.
drop function if exists public.payout_places_for(int);
create or replace function public.payout_places_for(p_field int, p_scheme public.payout_scheme default 'standard')
returns int
language sql immutable
as $$
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
$$;

-- Exact per-place payout (cents) for a pool, field size, and scheme. Sums to p_pool.
drop function if exists public.compute_payout_shares(int, int);
create or replace function public.compute_payout_shares(
  p_pool int, p_field int, p_scheme public.payout_scheme default 'standard')
returns int[]
language plpgsql immutable
as $$
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
$$;

-- Transparency helper: "pays top N" under the game's scheme.
create or replace function public.game_payout_summary(p_game_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
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
$$;
revoke execute on function public.game_payout_summary(uuid) from public, anon;
grant execute on function public.game_payout_summary(uuid) to authenticated;

-- payout_game: distribute via compute_payout_shares using the game's scheme.
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

-- admin_create_game gains a payout-scheme choice (set on the game after creation).
drop function if exists public.admin_create_game(public.game_mode);
create or replace function public.admin_create_game(
  p_mode public.game_mode default 'original_escalator',
  p_payout_scheme public.payout_scheme default 'standard')
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
  v_game := public.create_game(p_mode);
  update public.games set payout_scheme = p_payout_scheme where game_id = v_game.game_id
    returning * into v_game;
  perform public.log_admin_action('create_game', null, v_game.game_id,
    jsonb_build_object('mode', p_mode, 'payoutScheme', p_payout_scheme));
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game(public.game_mode, public.payout_scheme) from public, anon;
grant execute on function public.admin_create_game(public.game_mode, public.payout_scheme) to authenticated;
