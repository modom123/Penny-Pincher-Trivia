-- RLS design principle: all money movement and scoring happens through
-- SECURITY DEFINER functions (see later migrations), which bypass RLS via
-- the function owner's privileges. Direct client table access below is
-- therefore read-mostly and deliberately excludes anything an answer/score
-- could be inferred or forged from (correct_option, other players' wallets).

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.questions enable row level security;
alter table public.game_rounds enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.player_answers enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.cheat_flags enable row level security;
alter table public.processed_stripe_events enable row level security;

-- profiles: a user can see/update only their own row. Clients cannot alter
-- wallet_balance_cents themselves though - a column-level check trigger
-- guards that (see below).
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

create function public.prevent_client_wallet_edit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.wallet_balance_cents is distinct from old.wallet_balance_cents
     and auth.role() = 'authenticated' then
    raise exception 'wallet_balance_cents can only be changed via server-side functions';
  end if;
  return new;
end;
$$;

create trigger guard_wallet_balance
  before update on public.profiles
  for each row execute function public.prevent_client_wallet_edit();

-- games: readable by any authenticated player (lobby/status), never
-- writable directly by clients.
create policy "games_select_all" on public.games
  for select to authenticated using (true);

-- questions/game_rounds: intentionally NO policies for authenticated/anon.
-- correct_option must never be directly queryable by a client - question
-- text/options for the live round are only ever pushed out over the
-- Realtime broadcast channel by the server-side game engine.

-- player_game_stats: total_score / round reached is public leaderboard
-- information within a game, so any authenticated user may read it. Writes
-- only via SECURITY DEFINER functions.
create policy "player_game_stats_select_all" on public.player_game_stats
  for select to authenticated using (true);

-- player_answers: a player may see their own answer history only.
create policy "player_answers_select_own" on public.player_answers
  for select using (auth.uid() = user_id);

-- wallet_ledger: a player may see their own ledger only.
create policy "wallet_ledger_select_own" on public.wallet_ledger
  for select using (auth.uid() = user_id);

-- cheat_flags / processed_stripe_events: no client access at all (service
-- role / definer functions only) - no policies created means RLS denies
-- every row to anon/authenticated.

-- Harden search_path (fixes linter WARN function_search_path_mutable).
create or replace function public.prevent_client_wallet_edit()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.wallet_balance_cents is distinct from old.wallet_balance_cents
     and auth.role() = 'authenticated' then
    raise exception 'wallet_balance_cents can only be changed via server-side functions';
  end if;
  return new;
end;
$$;

-- handle_new_user/prevent_client_wallet_edit are trigger-only functions -
-- Postgres already blocks direct invocation of "returns trigger" functions,
-- but lock down PostgREST RPC exposure too, for defense in depth.
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke execute on function public.prevent_client_wallet_edit() from public, anon, authenticated, service_role;
