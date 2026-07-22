-- Prize-pool rollover for games that end with no eligible winner.
--
-- Today, if every player in a game ends up ineligible (all eliminated for
-- running out of funds after round 30, or a game nobody ever registered for
-- gets force-started - see engine_promote_due_registrations' max_rollovers
-- escape hatch), payout_game's winner loop simply runs zero iterations: no
-- wallet credits, no error, game marked 'completed'. The pool sits forever in
-- that now-untouchable row - not lost in the accounting sense (it's still
-- real cash the platform holds), but never paid to anyone and never
-- reachable by any other code path. This migration gives that money
-- somewhere to go: a freshly created, similarly-configured tournament, and
-- notifies the void game's players that it happened.
--
-- Naming note: this is unrelated to games.rollover_count /
-- engine_promote_due_registrations' "rolled_over" action, which is about a
-- REGISTRATION window being pushed back for lack of sign-ups before a game
-- ever starts. This feature is about a game that already finished with no
-- winner. Column names below are prefixed distinctly to avoid confusion.

alter table public.games add column if not exists pool_rollover_amount_cents int not null default 0;
alter table public.games add column if not exists rolled_over_from_game_id uuid references public.games(game_id);
alter table public.games add column if not exists rolled_over_to_game_id uuid references public.games(game_id);
alter table public.games add column if not exists rollover_notified_at timestamptz;

comment on column public.games.pool_rollover_amount_cents is
  'How much of this game''s total_prize_pool_cents was seeded from a void predecessor''s pool, rather than this game''s own entry fees/buy-ins. Kept separate so financial reconciliation can tell the two apart.';
comment on column public.games.rolled_over_from_game_id is
  'The void (no-winner) game whose leftover pool seeded this game, if any.';
comment on column public.games.rolled_over_to_game_id is
  'The replacement game this void game''s pool rolled into, if one could be created.';

-- Fix a latent bug this migration would otherwise inherit: log_admin_action
-- always inserts staff_user_id = auth.uid(), but admin_audit_log declared it
-- NOT NULL. Any system-initiated action (no authenticated staff session, e.g.
-- the game-engine worker calling a RPC via the service role) has auth.uid()
-- = null, so the insert violates the constraint and the whole calling
-- function's transaction rolls back. Confirmed live: admin_audit_log has
-- zero 'schedule_game_auto' rows despite engine_schedule_due_game running on
-- every worker poll since it was built - engine_schedule_due_game has never
-- successfully created a game. A system action legitimately has no staff
-- user attached, so make the column nullable rather than fake an actor.
alter table public.admin_audit_log alter column staff_user_id drop not null;

-- payout_game: same as 20260713030000's version, except the zero-eligible-
-- winner branch now creates a rollover game instead of silently no-opping.
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
  v_window_hours numeric;
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
  -- head start. Never let a failure here (e.g. a subject contest whose bank
  -- is no longer deep enough) block completing the void game itself.
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

      select coalesce((value->>'registration_window_hours')::numeric, 48)
        into v_window_hours from public.platform_config where key = 'game_scheduler';
      v_window_hours := coalesce(v_window_hours, 48);
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
        scheduled_start_at = now() + interval '1 hour' * v_window_hours::double precision,
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

-- ============================================================================
-- Rollover push notification (mirrors the tournament-start-reminder pattern:
-- an idempotent *_notified_at flag, a due-list RPC, a mark-sent RPC, both
-- service-role only, consumed by an edge function on the existing 5-min cron).
-- ============================================================================
create or replace function public.games_due_for_rollover_notification()
returns table (
  void_game_id uuid,
  mode public.game_mode,
  pool_rollover_amount_cents int,
  rolled_over_to_game_id uuid,
  new_game_scheduled_start_at timestamptz
)
language sql
security definer set search_path = public
as $$
  select g.game_id, g.mode, ng.pool_rollover_amount_cents, g.rolled_over_to_game_id, ng.scheduled_start_at
  from public.games g
  join public.games ng on ng.game_id = g.rolled_over_to_game_id
  where g.rolled_over_to_game_id is not null and g.rollover_notified_at is null;
$$;
revoke execute on function public.games_due_for_rollover_notification() from public, anon, authenticated;
grant execute on function public.games_due_for_rollover_notification() to service_role;

create or replace function public.mark_rollover_notified(p_game_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.games set rollover_notified_at = now() where game_id = p_game_id;
$$;
revoke execute on function public.mark_rollover_notified(uuid) from public, anon, authenticated;
grant execute on function public.mark_rollover_notified(uuid) to service_role;
