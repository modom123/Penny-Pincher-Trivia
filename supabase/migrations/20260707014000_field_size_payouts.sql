-- Field-size-scaled payouts: instead of always paying the top 3, the number of
-- paid places grows with the number of entrants, so a good-but-not-elite player in
-- a big field can still cash. This reduces variance and rewards a finer skill
-- ranking (supports the skill-predominance argument), and improves player retention.
--
-- Percentages are of the prize pool (which is already the 60% player share; the
-- platform's 40% is separate). Each tier set sums to 100. The schedule is data, so
-- staff can tune it without a code change.

create table public.payout_tiers (
  id serial primary key,
  min_players int not null unique,   -- applies when the eligible field is >= this
  tiers int[] not null,              -- percent of the prize pool per place; sums to 100
  label text not null,
  check (min_players >= 1)
);

insert into public.payout_tiers (min_players, tiers, label) values
  (1,  array[50,30,20],                               'Top 3 (50/30/20)'),
  (15, array[40,24,16,12,8],                          'Top 5'),
  (40, array[28,18,13,10,8,7,6,4,3,3],                'Top 10');

alter table public.payout_tiers enable row level security;
create policy "payout_tiers_read_authenticated" on public.payout_tiers
  for select using (auth.uid() is not null);
create policy "payout_tiers_write_staff" on public.payout_tiers
  for all using (public.is_staff(array['admin'])) with check (public.is_staff(array['admin']));

-- Which tier set applies to a given eligible-field size.
create or replace function public.payout_tiers_for(p_field_size int)
returns int[]
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select tiers from public.payout_tiers where min_players <= p_field_size order by min_players desc limit 1),
    array[50,30,20]
  );
$$;

-- Transparency helper: how many places would pay, given the current eligible field.
-- Used by the Lobby / Official Rules ("pays top N"). Players may read it.
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
    'placesPaid', least(coalesce(array_length(public.payout_tiers_for(f.field_size), 1), 0), f.field_size),
    'tiers', public.payout_tiers_for(f.field_size)
  )
  from f;
$$;
revoke execute on function public.game_payout_summary(uuid) from public, anon;
grant execute on function public.game_payout_summary(uuid) to authenticated;


-- payout_game: distribute the prize pool across the field-size-scaled tier set.
-- Ranking and tie-break unchanged (total_score DESC, total_cash_spent_cents ASC);
-- Sudden Death Overtime now triggers on a true dead heat anywhere in the PAID
-- places (not just the top 3), since a boundary tie decides who gets paid.
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
  v_field int;
  v_tiers int[];
  v_paid_places int;
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

  select count(*) into v_field
  from public.player_game_stats
  where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false;

  v_tiers := public.payout_tiers_for(v_field);
  v_paid_places := least(coalesce(array_length(v_tiers, 1), 0), v_field);

  -- Tie detection across the paid places (a dead heat at the payment boundary
  -- must be resolved before we pay out).
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
    -- Last paid place absorbs the rounding remainder so the pool sums exactly.
    v_share := case
      when v_place = v_paid_places then v_game.total_prize_pool_cents - v_distributed
      else round(v_game.total_prize_pool_cents * v_tiers[v_place] / 100.0)
    end;
    v_distributed := v_distributed + v_share;

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
