-- Upcoming games with a sign-up window, plus the auto-scheduler that creates them.
--
-- New game lifecycle:
--   registration  -- created by the scheduler; open for sign-ups, counting down
--                    to scheduled_start_at. Players pay a fixed cash entry fee
--                    that seeds this game's prize pool ("pot grows as people sign
--                    up"). Shown in the lobby with a countdown + live pot.
--   pending        -- start time reached with enough players (or a manually
--                    created instant game); the engine drives it now.
--   active/completed as before.
--
-- Cadence: the always-on worker pokes engine_schedule_due_game() every poll; the
-- DB decides (from platform_config -> 'game_scheduler') whether a new game is due
-- (default every 72h) and creates it with a registration window (default 48h).
-- At zero hour engine_promote_due_registrations() starts the game if it hit the
-- minimum sign-ups, otherwise rolls the start out by another window.

alter table public.games add column if not exists scheduled_start_at timestamptz;
alter table public.games add column if not exists entry_fee_cents int not null default 0;
alter table public.games add column if not exists min_players int not null default 1;
alter table public.games add column if not exists max_rollovers int not null default 3;
alter table public.games add column if not exists rollover_count int not null default 0;

-- Lobby scans upcoming + running games; keep those cheap to find.
create index if not exists idx_games_registration_due on public.games (scheduled_start_at)
  where status = 'registration';

-- Scheduler config (idempotent; never clobbers values tuned later in the dashboard).
insert into public.platform_config (key, value)
values ('game_scheduler', jsonb_build_object(
  'enabled', true,
  'interval_hours', 72,              -- create a new game this often
  'registration_window_hours', 48,   -- sign-up countdown before a game goes live
  'mode', 'rotate',                  -- 'rotate' cycles the 3 modes, or pin one
  'payout_scheme', 'standard',
  'round_seconds', 12,
  'entry_fee_cents', 500,            -- $5 cash sign-up buy-in -> prize pool
  'min_players', 2,                  -- below this at zero hour -> roll over
  'max_rollovers', 3                 -- after this many rollovers, run it anyway
))
on conflict (key) do nothing;

-- House rake on entry fees, in basis points. 0 = the full fee goes to the pot.
insert into public.platform_config (key, value)
values ('entry_fee_rake_bps', '0'::jsonb)
on conflict (key) do nothing;

-- Late-join cutoff: players can still "join now" an in-progress tournament while
-- its current round is at or below this number. Tied to the buy_round re-up /
-- top-up window (round 30) - if you can still re-up, you can still join.
insert into public.platform_config (key, value)
values ('late_join_cutoff_round', '30'::jsonb)
on conflict (key) do nothing;


-- ============================================================================
-- Player-facing: sign up for an upcoming game.
-- ============================================================================
-- Pays the game's fixed entry fee in CASH (so every seat funds the withdrawable
-- pot) and seats the player. Same region/compliance bar as buy_round.
create or replace function public.register_for_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile record;
  v_game record;
  v_cash_available int;
  v_fee int;
  v_rake_bps int;
  v_admin_cut int;
  v_prize_cut int;
  v_blocked_states jsonb;
  v_allowed_states jsonb;
  v_player_count int;
  v_cutoff int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select wallet_balance_cents, promo_balance_cents, is_suspended, region_state into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then raise exception 'Profile not found'; end if;
  if v_profile.is_suspended then raise exception 'Account suspended'; end if;

  -- Region gating (mirrors buy_round: a real-money transaction).
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

  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then raise exception 'Game not found'; end if;

  select coalesce((value #>> '{}')::int, 30) into v_cutoff
  from public.platform_config where key = 'late_join_cutoff_round';
  v_cutoff := coalesce(v_cutoff, 30);

  -- Two ways in: sign up before an upcoming game starts, or join an in-progress
  -- tournament while it's still inside the re-up window (current round <= cutoff).
  if v_game.status = 'registration' then
    if v_game.scheduled_start_at is not null and now() >= v_game.scheduled_start_at then
      raise exception 'Sign-ups for this game have closed';
    end if;
  elsif v_game.status = 'active' then
    if v_game.current_round > v_cutoff then
      raise exception 'JOIN_CLOSED: This tournament is past round % - joining closes at round %.',
        v_game.current_round, v_cutoff;
    end if;
  else
    raise exception 'This game is not open to join (status is %)', v_game.status;
  end if;

  if exists (select 1 from public.player_game_stats where game_id = p_game_id and user_id = v_user_id) then
    raise exception 'ALREADY_REGISTERED: You are already in this game';
  end if;

  v_fee := coalesce(v_game.entry_fee_cents, 0);
  -- Cash-only (wallet minus non-withdrawable promo), so every seat funds the pot.
  v_cash_available := v_profile.wallet_balance_cents - v_profile.promo_balance_cents;
  if v_fee > 0 and v_cash_available < v_fee then
    raise exception 'INSUFFICIENT_CASH: Signing up costs %c cash. Your withdrawable cash balance is %c.',
      v_fee, greatest(v_cash_available, 0);
  end if;

  select coalesce((value #>> '{}')::int, 0) into v_rake_bps from public.platform_config where key = 'entry_fee_rake_bps';
  v_rake_bps := coalesce(v_rake_bps, 0);
  v_admin_cut := round(v_fee * v_rake_bps / 10000.0);
  v_prize_cut := v_fee - v_admin_cut;

  if v_fee > 0 then
    update public.profiles
      set wallet_balance_cents = wallet_balance_cents - v_fee
      where user_id = v_user_id;

    update public.games
      set total_prize_pool_cents = total_prize_pool_cents + v_prize_cut,
          admin_revenue_pool_cents = admin_revenue_pool_cents + v_admin_cut
      where game_id = p_game_id returning * into v_game;

    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_user_id, 'entry_fee_debit', -v_fee, p_game_id);
  end if;

  insert into public.player_game_stats
    (user_id, game_id, current_round_reached, total_cash_spent_cents, total_tokens_spent_cents)
  values (v_user_id, p_game_id, 0, v_fee, v_fee);

  select count(*) into v_player_count from public.player_game_stats where game_id = p_game_id;

  return jsonb_build_object(
    'success', true,
    'gameId', p_game_id,
    'entryFeeCents', v_fee,
    'scheduledStartAt', v_game.scheduled_start_at,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'playerCount', v_player_count
  );
end;
$$;

revoke execute on function public.register_for_game(uuid) from public, anon;
grant execute on function public.register_for_game(uuid) to authenticated;


-- ============================================================================
-- Lobby read: upcoming + running games with pot, player count, and whether the
-- caller is already signed up. One RPC keeps the client simple and RLS-safe.
-- ============================================================================
create or replace function public.list_lobby_games()
returns table (
  game_id uuid,
  status text,
  mode public.game_mode,
  current_round int,
  total_rounds int,
  total_prize_pool_cents int,
  in_sudden_death boolean,
  scheduled_start_at timestamptz,
  entry_fee_cents int,
  min_players int,
  player_count int,
  is_registered boolean,
  join_open boolean,
  subject_name text,
  subject_domain text
)
language sql
security definer set search_path = public
as $$
  select
    g.game_id, g.status::text, g.mode, g.current_round, g.total_rounds,
    g.total_prize_pool_cents, g.in_sudden_death, g.scheduled_start_at,
    g.entry_fee_cents, g.min_players,
    (select count(*)::int from public.player_game_stats p where p.game_id = g.game_id) as player_count,
    exists (
      select 1 from public.player_game_stats p
      where p.game_id = g.game_id and p.user_id = auth.uid()
    ) as is_registered,
    -- Open to join: an upcoming game still counting down, or an active tournament
    -- still inside the late-join / re-up window.
    case
      when g.status = 'registration' then (g.scheduled_start_at is null or g.scheduled_start_at > now())
      when g.status = 'active' then g.current_round <= coalesce(
        (select (value #>> '{}')::int from public.platform_config where key = 'late_join_cutoff_round'), 30)
      else false
    end as join_open,
    s.name::text, s.domain::text
  from public.games g
  left join public.subjects s on s.id = g.subject_id
  where g.status in ('registration', 'pending', 'active')
  order by
    case g.status when 'active' then 0 when 'registration' then 1 else 2 end,
    g.scheduled_start_at nulls last,
    g.created_at desc;
$$;

revoke execute on function public.list_lobby_games() from public, anon;
grant execute on function public.list_lobby_games() to authenticated;


-- ============================================================================
-- Engine: only drive games that are actually ready to start.
-- ============================================================================
-- Redefines the lease-migration version to also gate 'pending' games on their
-- scheduled_start_at, so a scheduled game doesn't start before its window ends.
-- 'registration' games are never returned here (they're promoted first).
create or replace function public.engine_runnable_games()
returns table (game_id uuid, status text, current_round int, total_rounds int)
language sql
security definer set search_path = public
as $$
  select game_id, status::text, current_round, total_rounds
  from public.games
  where (
      status = 'active'
      or (status = 'pending' and (scheduled_start_at is null or scheduled_start_at <= now()))
    )
    and (engine_lease_owner is null
         or engine_lease_expires_at is null
         or engine_lease_expires_at < now())
  order by created_at;
$$;

revoke execute on function public.engine_runnable_games() from public, anon, authenticated;
grant execute on function public.engine_runnable_games() to service_role;


-- At zero hour, either start a registration game (enough sign-ups) or roll its
-- window forward. Returns a summary array of what it did this tick. Advisory lock
-- keeps concurrent engine instances from double-promoting.
create or replace function public.engine_promote_due_registrations()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_window_hours numeric;
  v_cfg jsonb;
  v_rec record;
  v_players int;
  v_actions jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('engine_promote_registrations')) then
    return jsonb_build_object('promoted', 0, 'rolledOver', 0, 'reason', 'locked');
  end if;

  select value into v_cfg from public.platform_config where key = 'game_scheduler';
  v_window_hours := coalesce((v_cfg->>'registration_window_hours')::numeric, 48);

  for v_rec in
    select game_id, min_players, max_rollovers, rollover_count
    from public.games
    where status = 'registration'
      and scheduled_start_at is not null
      and scheduled_start_at <= now()
    for update skip locked
  loop
    select count(*) into v_players from public.player_game_stats where game_id = v_rec.game_id;

    if v_players >= v_rec.min_players or v_rec.rollover_count >= v_rec.max_rollovers then
      -- Go live now: hand it to the engine's normal pending -> active path.
      update public.games set status = 'pending' where game_id = v_rec.game_id;
      v_actions := v_actions || jsonb_build_object(
        'gameId', v_rec.game_id, 'action', 'started', 'players', v_players);
    else
      -- Not enough sign-ups yet: push the window out and keep taking them.
      update public.games
        set scheduled_start_at = now() + interval '1 hour' * v_window_hours::double precision,
            rollover_count = rollover_count + 1
        where game_id = v_rec.game_id;
      v_actions := v_actions || jsonb_build_object(
        'gameId', v_rec.game_id, 'action', 'rolled_over', 'players', v_players,
        'rolloverCount', v_rec.rollover_count + 1);
    end if;
  end loop;

  return jsonb_build_object('actions', v_actions);
end;
$$;

revoke execute on function public.engine_promote_due_registrations() from public, anon, authenticated;
grant execute on function public.engine_promote_due_registrations() to service_role;


-- Creates a game iff one is due per the config. Returns a jsonb summary rather
-- than raising, so the engine can log a clean line and move on. service_role only.
create or replace function public.engine_schedule_due_game()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_cfg jsonb;
  v_interval_hours numeric;
  v_window_hours numeric;
  v_mode_cfg text;
  v_mode public.game_mode;
  v_scheme public.payout_scheme;
  v_secs int;
  v_fee int;
  v_min_players int;
  v_max_rollovers int;
  v_last_created timestamptz;
  v_last_mode public.game_mode;
  v_game public.games;
begin
  if not pg_try_advisory_xact_lock(hashtext('engine_game_scheduler')) then
    return jsonb_build_object('created', false, 'reason', 'locked');
  end if;

  select value into v_cfg from public.platform_config where key = 'game_scheduler';
  if v_cfg is null then
    return jsonb_build_object('created', false, 'reason', 'unconfigured');
  end if;
  if not coalesce((v_cfg->>'enabled')::boolean, false) then
    return jsonb_build_object('created', false, 'reason', 'disabled');
  end if;

  v_interval_hours := coalesce((v_cfg->>'interval_hours')::numeric, 72);
  v_window_hours   := coalesce((v_cfg->>'registration_window_hours')::numeric, 48);
  v_mode_cfg       := coalesce(v_cfg->>'mode', 'rotate');
  v_scheme         := coalesce(v_cfg->>'payout_scheme', 'standard')::public.payout_scheme;
  v_secs           := least(greatest(coalesce((v_cfg->>'round_seconds')::int, 12), 5), 60);
  v_fee            := greatest(coalesce((v_cfg->>'entry_fee_cents')::int, 0), 0);
  v_min_players    := greatest(coalesce((v_cfg->>'min_players')::int, 1), 1);
  v_max_rollovers  := greatest(coalesce((v_cfg->>'max_rollovers')::int, 0), 0);

  -- Cadence anchor: newest non-cancelled game (a cancelled one doesn't hold the clock).
  select created_at, mode into v_last_created, v_last_mode
  from public.games where status <> 'cancelled'
  order by created_at desc limit 1;

  if v_last_created is not null
     and now() - v_last_created < interval '1 hour' * v_interval_hours::double precision then
    return jsonb_build_object('created', false, 'reason', 'not_due',
      'nextDueAt', v_last_created + interval '1 hour' * v_interval_hours::double precision);
  end if;

  -- 'rotate' advances from the last game's mode; any other value pins that mode.
  if v_mode_cfg = 'rotate' then
    v_mode := case v_last_mode
      when 'original_escalator' then 'streak_saver'
      when 'streak_saver' then 'milestone_booster'
      when 'milestone_booster' then 'original_escalator'
      else 'original_escalator' end;
  else
    v_mode := v_mode_cfg::public.game_mode;
  end if;

  -- Build the game (mirrors admin_create_game, minus the staff gate). create_game
  -- raises if the question bank is missing a level; catch so a bad bank can't
  -- crash the poll loop.
  begin
    v_game := public.create_game(v_mode);
  exception when others then
    return jsonb_build_object('created', false, 'reason', 'create_failed',
      'mode', v_mode::text, 'error', sqlerrm);
  end;

  update public.games
    set payout_scheme = v_scheme,
        round_seconds = v_secs,
        entry_fee_cents = v_fee,
        min_players = v_min_players,
        max_rollovers = v_max_rollovers,
        rollover_count = 0,
        scheduled_start_at = now() + interval '1 hour' * v_window_hours::double precision,
        status = 'registration'
    where game_id = v_game.game_id returning * into v_game;
  update public.game_rounds
    set time_limit_override_seconds = v_secs
    where game_id = v_game.game_id;

  perform public.log_admin_action('schedule_game_auto', null, v_game.game_id,
    jsonb_build_object('mode', v_mode::text, 'payoutScheme', v_scheme::text,
      'roundSeconds', v_secs, 'entryFeeCents', v_fee, 'minPlayers', v_min_players,
      'registrationWindowHours', v_window_hours, 'intervalHours', v_interval_hours));

  return jsonb_build_object('created', true, 'gameId', v_game.game_id,
    'mode', v_mode::text, 'status', v_game.status,
    'scheduledStartAt', v_game.scheduled_start_at, 'entryFeeCents', v_fee);
end;
$$;

revoke execute on function public.engine_schedule_due_game() from public, anon, authenticated;
grant execute on function public.engine_schedule_due_game() to service_role;
