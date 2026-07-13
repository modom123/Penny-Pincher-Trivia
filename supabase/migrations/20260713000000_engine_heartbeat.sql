-- Game-engine heartbeat, so the Command Center can show whether the worker
-- process is actually alive (not just whether games happen to be advancing).
--
-- The engine (--watch loop) upserts one row per instance every poll (~15s) with
-- its last-seen time and how many games it's currently running. Staff read it;
-- the dashboard flags the engine offline if the newest heartbeat is stale.

create table if not exists public.engine_heartbeats (
  instance_id       text primary key,
  last_heartbeat_at timestamptz not null default now(),
  games_in_flight   int not null default 0,
  started_at        timestamptz not null default now()
);

comment on table public.engine_heartbeats is
  'Liveness beacons written by the game-engine worker(s). One row per instance; last_heartbeat_at refreshed every watch poll.';

alter table public.engine_heartbeats enable row level security;

-- Staff can read engine status in the Command Center. Writes come from the
-- engine using the service_role key, which bypasses RLS (no write policy needed;
-- clients must never write this).
create policy "engine_heartbeats_staff_read" on public.engine_heartbeats
  for select using (public.is_staff());

grant select on public.engine_heartbeats to authenticated;
