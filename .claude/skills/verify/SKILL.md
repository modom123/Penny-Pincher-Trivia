---
name: verify
description: How to verify changes to Penny Pincher Trivia's Supabase-backed logic in this sandbox.
---

# Verifying this repo

Most of the real logic lives in Postgres `SECURITY DEFINER` functions
(`supabase/migrations/`), not application code. The real client path is:
mobile app / command center calls `supabase.rpc('fn_name', {...})` ->
PostgREST resolves the caller's JWT, sets `request.jwt.claims` +
`role=authenticated`, and invokes the plpgsql function.

## This sandbox cannot reach Supabase over HTTPS

Outbound network to `*.supabase.co` is blocked by this environment's egress
policy (confirmed via direct `fetch`: `403 Host not in allowlist`). Electron's
binary CDN and Expo's `exp.host` telemetry are blocked the same way. This
means:
- You cannot run the mobile app, command center, or desktop app against the
  live backend from a terminal in this sandbox and watch it work end-to-end.
- The `mcp__Supabase__*` tools (execute_sql, apply_migration, deploy_edge_function,
  get_advisors, get_logs) DO have real network access - they run server-side,
  not through this sandbox's proxy. This is your actual verification surface.

## How to drive the real surface anyway

`execute_sql` runs directly against the live Postgres database - the exact
same functions PostgREST calls, no separate application layer to fake out.
Simulate the caller identity PostgREST would set:

```sql
select set_config('request.jwt.claims', json_build_object('sub', '<user-uuid>')::text, true);
select set_config('role', 'authenticated', true);
select public.some_rpc_function(...);
```

This is a real invocation of the real deployed function, not a unit test -
there is nothing else between PostgREST and this function in production.

**Gotcha: each `execute_sql` call is one implicit transaction.** If a later
statement in the same call raises, everything earlier in that same call rolls
back too (including `UPDATE`s that "looked" like they succeeded until the
error surfaced). If a multi-step scenario fails partway through, redo the
whole batch from a state-setup statement, not just the failing line.

**Gotcha: round timers are real wall-clock, so back-and-forth tool calls burn
the clock.** A round with a 10-12s time limit will often have expired by the
time you follow up in a new tool call. Put `start_round` (or `admin`
equivalents that reset `started_at`) in the *same* `execute_sql` call as the
`buy_round`/`submit_answer` you're testing, not a prior one.

**Gotcha: for financial/game-state tests, always clean up.** Insert throwaway
`auth.users` rows for test players (`insert into auth.users (id, email,
encrypted_password, email_confirmed_at, raw_user_meta_data, aud, role)
values (gen_random_uuid(), '...@example.com', crypt('password123',
gen_salt('bf')), now(), '{"username":"..."}'::jsonb, 'authenticated',
'authenticated')`), which fires the `handle_new_user` trigger and creates a
matching `profiles` row automatically. Delete test games/users when done -
this is a real (if currently low-traffic) production project, not a
throwaway sandbox. Delete order matters due to FKs: `cheat_flags` ->
`player_answers` -> `wallet_ledger` -> `sudden_death_participants` ->
`player_game_stats` -> `game_rounds` -> `games`, then `auth.users` (cascades
`profiles`). If the test user acted as staff (called any `admin_*` RPC),
also delete their `admin_audit_log` rows first - every admin action logs
one, and it FKs to `auth.users`, so it'll block the user delete otherwise.

## After any migration touching grants

Supabase's `public` schema has `ALTER DEFAULT PRIVILEGES` that auto-grant
`EXECUTE` to `anon`/`authenticated`/`service_role` on every new function.
`REVOKE ... FROM PUBLIC` does **not** remove these - they're explicit
per-role grants, not the PUBLIC pseudo-grant. Always
`REVOKE ... FROM PUBLIC, anon, authenticated` (naming the roles) then
re-`GRANT` only what's intended, and verify with:

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'your_function';
```

Run `mcp__Supabase__get_advisors(type: 'security')` after schema/grant
changes too - it catches missing RLS policies and over-broad grants the ACL
check above might miss.

## Frontends (mobile/, command-center/, desktop/)

Given the network block above, the ceiling here is: `npm install`,
`npm run typecheck` / `tsc --noEmit`, and `npm run build` (or `expo export
--platform web` for mobile, with `EXPO_OFFLINE=1` to skip the blocked
`exp.host` version check). These catch real errors (missing deps, type
errors, bundler resolution failures) but are **not** a substitute for
running the app - say so explicitly rather than claiming a UI change works.
If given an environment with real internet access, run the apps for real
against this same Supabase project and drive the actual screens.
