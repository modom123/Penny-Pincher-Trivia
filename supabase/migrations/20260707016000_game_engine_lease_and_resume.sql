-- Game-engine reliability: a per-game LEASE so the worker in game-engine/ can be
-- run safely as more than a fire-and-forget script.
--
-- Two production holes this closes:
--   1. Orphaned games. The old --watch poller only picked up status='pending'
--      games. The moment a game went 'active', a worker crash/redeploy left it
--      stranded with no driver. engine_runnable_games() now also surfaces
--      'active' games whose lease has lapsed, and engine_game_state() tells the
--      worker where to resume so it doesn't replay rounds players already cleared.
--   2. Double-drive. Two worker instances both saw the same pending game and both
--      ran it (duplicate round:start/round:end broadcasts, double advances).
--      claim_game_for_engine() is an atomic conditional UPDATE, so exactly one
--      worker can hold a game at a time.
--
-- Leases are soft (time-boxed) and self-healing: a dead worker's lease simply
-- expires and another worker reclaims the game. All functions are service-role
-- only, matching the rest of the engine surface.

alter table public.games
  add column engine_lease_owner text,
  add column engine_lease_expires_at timestamptz;

-- Partial index: the watcher only ever scans not-yet-finished games.
create index idx_games_engine_runnable on public.games (status)
  where status in ('pending', 'active');


-- Atomically claim a game for one worker. Succeeds only if the game is runnable
-- (pending or active - never completed) and currently unleased, self-owned, or
-- holding a lapsed lease. Returns whether this worker now owns it.
create or replace function public.claim_game_for_engine(
  p_game_id uuid, p_worker_id text, p_lease_seconds int default 30)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_claimed boolean;
begin
  if p_worker_id is null or length(p_worker_id) = 0 then
    raise exception 'worker id required';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'lease seconds must be positive';
  end if;

  update public.games
  set engine_lease_owner = p_worker_id,
      engine_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where game_id = p_game_id
    and status in ('pending', 'active')
    and (engine_lease_owner is null
         or engine_lease_owner = p_worker_id
         or engine_lease_expires_at is null
         or engine_lease_expires_at < now())
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke execute on function public.claim_game_for_engine(uuid, text, int) from public, anon, authenticated;
grant execute on function public.claim_game_for_engine(uuid, text, int) to service_role;


-- Extend a lease the worker still owns. The worker calls this on a timer while
-- driving a game; a false return means the lease was lost (reclaimed by another
-- worker after an apparent stall) and the caller must stop driving.
create or replace function public.heartbeat_game_lease(
  p_game_id uuid, p_worker_id text, p_lease_seconds int default 30)
returns boolean
language plpgsql
security definer set search_path = public
as $$
declare
  v_ok boolean;
begin
  update public.games
  set engine_lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where game_id = p_game_id and engine_lease_owner = p_worker_id
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke execute on function public.heartbeat_game_lease(uuid, text, int) from public, anon, authenticated;
grant execute on function public.heartbeat_game_lease(uuid, text, int) to service_role;


-- Release a lease on clean shutdown / game completion. No-op unless still owner.
create or replace function public.release_game_lease(p_game_id uuid, p_worker_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.games
  set engine_lease_owner = null, engine_lease_expires_at = null
  where game_id = p_game_id and engine_lease_owner = p_worker_id;
end;
$$;

revoke execute on function public.release_game_lease(uuid, text) from public, anon, authenticated;
grant execute on function public.release_game_lease(uuid, text) to service_role;


-- Games a worker may pick up: pending (never started) or active (a prior worker
-- died mid-game) with no live lease. Ordered oldest-first so backlogged games run
-- before newly created ones.
create or replace function public.engine_runnable_games()
returns table (game_id uuid, status text, current_round int, total_rounds int)
language sql
security definer set search_path = public
as $$
  select game_id, status::text, current_round, total_rounds
  from public.games
  where status in ('pending', 'active')
    and (engine_lease_owner is null
         or engine_lease_expires_at is null
         or engine_lease_expires_at < now())
  order by created_at;
$$;

revoke execute on function public.engine_runnable_games() from public, anon, authenticated;
grant execute on function public.engine_runnable_games() to service_role;


-- Where a (re)claimed game should resume. Lets a worker continue a game a crashed
-- worker left half-run: currentRoundEnded distinguishes "round is still open,
-- re-open it" from "round already scored, advance past it".
create or replace function public.engine_game_state(p_game_id uuid)
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', g.status,
    'currentRound', g.current_round,
    'totalRounds', g.total_rounds,
    'inSuddenDeath', g.in_sudden_death,
    'currentRoundEnded', coalesce((
      select gr.ended_at is not null
      from public.game_rounds gr
      where gr.game_id = g.game_id and gr.round_number = g.current_round
    ), false)
  )
  from public.games g
  where g.game_id = p_game_id;
$$;

revoke execute on function public.engine_game_state(uuid) from public, anon, authenticated;
grant execute on function public.engine_game_state(uuid) to service_role;


-- end_round: the live leaderboard broadcast now excludes players who can't
-- actually place (eliminated for insufficient funds, or disqualified for cheat
-- flags), so "who's winning" mid-game matches who payout_game would pay. Timing,
-- prize-pool, and final-round semantics are otherwise unchanged.
create or replace function public.end_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_correct varchar(1);
  v_total_rounds int;
  v_pool int;
  v_leaderboard jsonb;
begin
  update public.game_rounds set ended_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select q.correct_option into v_correct
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;

  select total_rounds, total_prize_pool_cents into v_total_rounds, v_pool
  from public.games where game_id = p_game_id;

  select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'score', total_score)), '[]'::jsonb)
  into v_leaderboard
  from (
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id
      and is_eligible_for_grand_prize = true
      and is_eliminated = false
    order by total_score desc limit 10
  ) top;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'correctOption', v_correct,
    'leaderboard', v_leaderboard,
    'totalPrizePoolCents', v_pool,
    'isFinalRound', p_round_number >= v_total_rounds
  );
end;
$$;

revoke execute on function public.end_round(uuid, int) from public, anon, authenticated;
grant execute on function public.end_round(uuid, int) to service_role;
