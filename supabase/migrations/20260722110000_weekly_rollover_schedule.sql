-- Product decision: a void (no-eligible-winner) game's replacement tournament
-- (see 20260722060000_prize_pool_rollover.sql) used to open for registration
-- immediately on the same ad-hoc registration_window_hours as any other
-- auto-scheduled game - i.e. "a few hours from whenever the void game
-- happened to finish". It now opens on a fixed WEEKLY slot instead: a
-- predictable weekly "second chance" appointment, closer to how a lottery's
-- draw time works, rather than a random near-term window.
--
-- Explicitly NOT pooling pools across modes or across multiple void games -
-- that was considered and deliberately rejected (an accumulating, unclaimed
-- jackpot pooled across the whole platform is a much stronger "this looks
-- like a lottery, not a skill contest" signal to regulators than a single
-- void game's own pool seeding one same-mode replacement - see the AMOE/
-- classification question in legal/00-READ-ME-FIRST.md item 1). Each void
-- game still seeds exactly one same-mode, same-config replacement; only that
-- replacement's START TIME changed, from "soon" to "the next weekly slot".
insert into public.platform_config (key, value)
values ('rollover_schedule', jsonb_build_object(
  'day_of_week', 6,  -- 0=Sunday .. 6=Saturday (matches Postgres extract(dow from ...))
  'hour_utc', 18      -- 18:00 UTC Saturday - tune from Command Center's platform_config editor
))
on conflict (key) do nothing;

-- Next occurrence of the configured weekly slot, pushed a further week out if
-- the naive next occurrence is within p_min_lead_hours - so a void game that
-- completes right before this week's slot doesn't hand its replacement an
-- unfairly short (or already-passed) registration window.
create or replace function public.next_weekly_rollover_slot(p_min_lead_hours numeric default 4)
returns timestamptz
language plpgsql
stable
as $$
declare
  v_cfg jsonb;
  v_dow int;
  v_hour int;
  v_candidate timestamptz;
  v_days_ahead int;
begin
  select value into v_cfg from public.platform_config where key = 'rollover_schedule';
  v_dow := coalesce((v_cfg->>'day_of_week')::int, 6);
  v_hour := coalesce((v_cfg->>'hour_utc')::int, 18);

  v_days_ahead := (v_dow - extract(dow from now() at time zone 'utc')::int + 7) % 7;
  v_candidate := (date_trunc('day', now() at time zone 'utc')
                  + (v_days_ahead || ' days')::interval
                  + (v_hour || ' hours')::interval) at time zone 'utc';

  if v_candidate <= now() + (p_min_lead_hours || ' hours')::interval then
    v_candidate := v_candidate + interval '7 days';
  end if;

  return v_candidate;
end;
$$;

-- payout_game: identical to 20260722060000's version except the rollover
-- game's scheduled_start_at now comes from next_weekly_rollover_slot()
-- instead of now() + registration_window_hours.
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
  v_rollover_game public.games;
  v_rollover_game_id uuid;
  v_secs int;
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

  -- No eligible winner: instead of letting the pool sit on a completed game
  -- forever, spin up a similarly-configured game and hand it the pool as a
  -- head start, opening for registration at the next weekly rollover slot.
  -- Never let a failure here (e.g. a subject contest whose bank is no longer
  -- deep enough) block completing the void game itself.
  if v_field = 0 and v_game.total_prize_pool_cents > 0 then
    begin
      if v_game.subject_id is not null then
        begin
          v_rollover_game := public.create_game_for_subject(v_game.subject_id);
        exception when others then
          v_rollover_game := public.create_game(v_game.mode);
        end;
      else
        v_rollover_game := public.create_game(v_game.mode);
      end if;

      v_secs := least(greatest(coalesce(v_game.round_seconds, 12), 5), 60);

      update public.games set
        payout_scheme = v_game.payout_scheme,
        round_seconds = v_secs,
        reup_cutoff_round = v_game.reup_cutoff_round,
        min_buy_in_tokens = v_game.min_buy_in_tokens,
        max_buy_in_tokens = v_game.max_buy_in_tokens,
        entry_fee_cents = v_game.entry_fee_cents,
        min_players = v_game.min_players,
        max_rollovers = v_game.max_rollovers,
        rollover_count = 0,
        status = 'registration',
        scheduled_start_at = public.next_weekly_rollover_slot(),
        total_prize_pool_cents = v_game.total_prize_pool_cents,
        pool_rollover_amount_cents = v_game.total_prize_pool_cents,
        rolled_over_from_game_id = p_game_id
      where game_id = v_rollover_game.game_id;
      update public.game_rounds set time_limit_override_seconds = v_secs where game_id = v_rollover_game.game_id;

      v_rollover_game_id := v_rollover_game.game_id;
      update public.games set rolled_over_to_game_id = v_rollover_game_id where game_id = p_game_id;

      perform public.log_admin_action('pool_rollover', null, p_game_id,
        jsonb_build_object('rolledOverToGameId', v_rollover_game_id, 'amountCents', v_game.total_prize_pool_cents));
    exception when others then
      -- Leave rolled_over_to_game_id null; total_prize_pool_cents > 0 on a
      -- completed game with no rollover target is the signal for staff to
      -- create one manually from the command center.
      v_rollover_game_id := null;
    end;
  end if;

  update public.games set status = 'completed', completed_at = now(), in_sudden_death = false where game_id = p_game_id;
  delete from public.sudden_death_participants where game_id = p_game_id;

  return jsonb_build_object(
    'status', 'completed', 'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'fieldSize', v_field, 'placesPaid', v_paid_places,
    'payoutScheme', v_game.payout_scheme, 'payouts', v_payouts,
    'noWinner', v_field = 0,
    'rolloverGameId', v_rollover_game_id
  );
end;
$$;
