-- Go-live compliance layer: KYC, tax thresholds, geo-fencing, and the black-box
-- event ledger. Vendor integrations (Persona/Stripe Identity, Radar.io/GeoComply,
-- Stripe Tax, Zendesk) are wired as pluggable webhook/config points - the
-- ENFORCEMENT lives here in Postgres so it holds regardless of which vendor is
-- swapped in, and can't be bypassed by a client.

-- KYC
alter table public.profiles add column kyc_status varchar(20) not null default 'unverified'; -- unverified | pending | verified | rejected
alter table public.profiles add column date_of_birth date;
alter table public.profiles add column kyc_provider_ref varchar(255);
alter table public.profiles add column kyc_verified_at timestamptz;

-- Tax. IRS 1099-MISC threshold is $600/yr; we lock at $550 to collect W-9 details
-- BEFORE the player crosses it, per the go-live design.
-- [COUNSEL: confirm threshold + that this is calendar-year, not lifetime, for your
-- final tax treatment - "lifetime" here is a conservative simplification.]
alter table public.profiles add column lifetime_winnings_cents int not null default 0;
alter table public.profiles add column tax_details_confirmed boolean not null default false;

-- Geo-fencing
alter table public.profiles add column region_state varchar(2);            -- last verified US state code
alter table public.profiles add column region_verified_at timestamptz;
alter table public.profiles add column region_country varchar(2) default 'US';

-- Black Box Ledger: append-only forensic log of every timing-relevant client
-- event, kept 48h for dispute adjudication ("your tap hit our server at 12.01s,
-- past the cutoff"). server_received_at is set by the DB default, never by the client.
create table public.websocket_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(user_id),
  game_id uuid references public.games(game_id),
  round_number int,
  event_type varchar(40) not null,        -- round_shown | answer_tap | answer_accepted | answer_rejected | ping | disconnect
  client_timestamp_ms bigint,             -- what the client claims (untrusted, for comparison only)
  server_time_taken_ms int,               -- authoritative elapsed time when known
  detail jsonb,
  server_received_at timestamptz not null default clock_timestamp()
);
alter table public.websocket_logs enable row level security;
create index idx_websocket_logs_user on public.websocket_logs(user_id, server_received_at desc);
create index idx_websocket_logs_game on public.websocket_logs(game_id, round_number);
create index idx_websocket_logs_purge on public.websocket_logs(server_received_at);

-- Players may read their own recent logs; compliance/support/admin staff read all.
create policy "websocket_logs_select_own" on public.websocket_logs
  for select using (auth.uid() = user_id or public.is_staff(array['admin','support','compliance']));

-- Link support tickets to a specific game/round so a dispute can be adjudicated
-- against the black-box log directly.
alter table public.support_tickets add column game_id uuid references public.games(game_id);
alter table public.support_tickets add column round_number int;
