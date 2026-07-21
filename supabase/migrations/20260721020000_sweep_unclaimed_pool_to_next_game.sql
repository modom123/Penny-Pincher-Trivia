-- Gap: if a game reaches round 100 with ZERO eligible, non-eliminated players
-- (everyone ran out of funds or got disqualified before the end), payout_game
-- already handles it without erroring - compute_payout_shares returns '{}' for a
-- field of 0, so the game just completes with no payouts. But nothing then
-- happened to the money: total_prize_pool_cents stayed on the completed game row,
-- never paid to anyone, never refunded, never swept anywhere. That's real player
-- money becoming permanently unaccounted for.
--
-- Fix: when payout_game finds a field of 0, sweep that game's ENTIRE prize pool
-- (never admin_revenue_pool_cents - the platform's cut is untouched either way)
-- into a rollover holding row, and zero out the source game's pool so its own
-- bookkeeping stays internally consistent (0 pool, 0 payouts, still balances).
-- The next game CREATED in the same mode claims any unclaimed rollover for that
-- mode as a starting-pool boost at creation time.
--
-- This only ever moves money players already contributed to a completed game's
-- pool into a future game's pool of the SAME mode ("sweep to similar") - never
-- platform-funded, never cash out of thin air, so it doesn't reopen the
-- sweepstakes-classification question flagged for a *platform*-funded bonus (see
-- 20260709000000_milestone_booster_drop_platform_bonus.sql). It's the same
-- entry-fee money, just carried forward instead of orphaned.
--
-- Financials reconciliation (command-center/src/pages/FinancialsPage.tsx) is
-- updated in the same commit to account for swept-in/swept-out amounts per game,
-- since a straight source-game-cash-contributed vs pool+cut comparison would now
-- show a false mismatch on both the source and destination games.

create table public.game_pool_rollovers (
  id uuid primary key default gen_random_uuid(),
  source_game_id uuid not null references public.games(game_id),
  dest_game_id uuid references public.games(game_id),
  mode public.game_mode not null,
  amount_cents int not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create index idx_game_pool_rollovers_unclaimed on public.game_pool_rollovers(mode) where dest_game_id is null;
alter table public.game_pool_rollovers enable row level security;
create policy "game_pool_rollovers_select_all" on public.game_pool_rollovers
  for select to authenticated using (true);

-- 1. payout_game: sweep instead of orphaning when nobody's left to pay.
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
  v_swept_cents int := 0;
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

  if v_field = 0 then
    if v_game.total_prize_pool_cents > 0 then
      v_swept_cents := v_game.total_prize_pool_cents;
      insert into public.game_pool_rollovers (source_game_id, mode, amount_cents)
      values (p_game_id, v_game.mode, v_swept_cents);
      update public.games set total_prize_pool_cents = 0 where game_id = p_game_id;
    end if;

    update public.games set status = 'completed', completed_at = now(), in_sudden_death = false where game_id = p_game_id;
    delete from public.sudden_death_participants where game_id = p_game_id;

    return jsonb_build_object(
      'status', 'completed', 'gameId', p_game_id,
      'totalPrizePoolCents', 0,
      'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
      'fieldSize', 0, 'placesPaid', 0,
      'payoutScheme', v_game.payout_scheme, 'payouts', '[]'::jsonb,
      'poolSweptCents', v_swept_cents
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
    'payoutScheme', v_game.payout_scheme, 'payouts', v_payouts,
    'poolSweptCents', 0
  );
end;
$$;

-- 2. create_game: claim any unclaimed rollover(s) for this mode as a starting-pool
-- boost. Faithful copy of 20260721000000's create_game with the claim step added
-- at the end.
create or replace function public.create_game(p_mode public.game_mode default 'original_escalator')
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_missing int[];
  v_swept_cents int := 0;
begin
  insert into public.games (status, current_round, total_rounds, mode)
  values ('draft', 0, 100, p_mode) returning * into v_game;

  select array_agg(r) into v_missing
  from generate_series(1, 100) r
  where not exists (select 1 from public.questions q where q.difficulty_level = r);
  if v_missing is not null then
    raise exception 'No question bank entries for rounds: %', v_missing;
  end if;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  select
    v_game.game_id, q.difficulty_level, q.question_id, q.difficulty_level
  from (
    -- Least-recently-used per level: fewest prior game assignments first, then random.
    select distinct on (qq.difficulty_level) qq.difficulty_level, qq.question_id
    from public.questions qq
    left join (
      select question_id, count(*)::int as uses
      from public.game_rounds
      group by question_id
    ) u on u.question_id = qq.question_id
    where qq.difficulty_level between 1 and 100
    order by qq.difficulty_level, coalesce(u.uses, 0) asc, random()
  ) q;

  with claimed as (
    update public.game_pool_rollovers
    set dest_game_id = v_game.game_id, claimed_at = now()
    where mode = p_mode and dest_game_id is null
    returning amount_cents
  )
  select coalesce(sum(amount_cents), 0) into v_swept_cents from claimed;

  if v_swept_cents > 0 then
    update public.games set total_prize_pool_cents = total_prize_pool_cents + v_swept_cents
    where game_id = v_game.game_id
    returning * into v_game;
  end if;

  return v_game;
end;
$$;
revoke execute on function public.create_game(public.game_mode) from public, anon, authenticated;
grant execute on function public.create_game(public.game_mode) to service_role;
