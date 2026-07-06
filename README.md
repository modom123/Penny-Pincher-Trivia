# Penny Pincher Trivia

A 100-round progressive trivia game: round *N* costs *N* tokens (1 token = 1 cent) to
enter, the pot grows as players unlock rounds, and the top 3 scorers at round 100 split
60% of the pot (50/30/20); the platform keeps the other 40%.

> **Heads up:** this is a real-money pay-to-play contest with pooled entry fees and a
> cash payout to winners. That's a legally operable model in much of the US (similar to
> daily-fantasy-sports/skill-contest platforms), but it carries real compliance weight -
> money transmitter licensing, state-by-state skill-game restrictions, Stripe's
> gambling-adjacent use policies, and KYC on withdrawals. Get this reviewed by a lawyer
> before it goes live with real users and real money.

## Architecture

- **Database & auth**: Supabase Postgres + Supabase Auth. `supabase/migrations/` holds
  the full schema, RLS policies, and Postgres functions.
- **Money & scoring logic**: implemented as `SECURITY DEFINER` Postgres functions
  (`buy_round`, `submit_answer`, `payout_game`, etc.), not application code - this keeps
  every wallet debit/credit atomic and auditable at the database layer, and RLS ensures
  clients can never read `questions.correct_option` or edit their own
  `wallet_balance_cents` directly.
- **Game engine** (`game-engine/`): a small persistent Node process. This is the one
  piece that *can't* be serverless - Supabase Edge Functions can't hold a timer spanning
  the ~30 minutes a full 100-round game takes. It calls `start_round`/`end_round`/
  `payout_game` and broadcasts the results over a Supabase Realtime channel
  (`game:{gameId}`) that clients subscribe to.
- **Edge Functions** (`supabase/functions/`): Stripe checkout session creation, the
  Stripe webhook (credits wallets on payment), withdrawals (Stripe Connect payout), and
  admin game creation.
- **Mobile app** (`mobile/`): Expo/React Native, using `@supabase/supabase-js` directly
  for auth, RPC calls, and Realtime.

## Anti-cheat

- The server's clock is the only source of truth for timing - `submit_answer` computes
  elapsed time from `game_rounds.started_at` via `clock_timestamp()`, never from a
  client-reported timestamp, and rejects anything submitted after
  `time_limit_seconds + 500ms`.
- Answers faster than 300ms are flagged (`cheat_flags`); after 3 flags in one game, the
  player is disqualified from the prize pool (but can keep playing).

## Setup

### 1. Supabase project

Migrations already applied to project `pkvdthwqvjpxhqorfpub` (org "Penny Pincher
Trivia"). To reproduce on a fresh project:

```bash
supabase link --project-ref <your-project-ref>
supabase db push   # applies everything in supabase/migrations/
```

100 placeholder trivia questions are seeded (one per round, `difficulty_level` 1-100) -
replace with real licensed/curated content before launch.

### 2. Edge Function secrets

Set these in Supabase (Project Settings -> Edge Functions -> Secrets), then redeploy:

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `APP_PUBLIC_URL` (used for Stripe Checkout success/cancel redirect URLs)
- `ADMIN_USER_IDS` (comma-separated Supabase auth user ids allowed to call
  `create-game`)

Deploy functions with `supabase functions deploy <name>`.

### 3. Game engine worker

```bash
cd game-engine
cp .env.example .env   # fill in SUPABASE_SERVICE_ROLE_KEY
npm install
node index.js <gameId> [<gameId2> ...]
```

Create a game first (via the `create-game` Edge Function, as an allowlisted admin),
then pass its `game_id` to the engine to run its 100-round loop.

### 4. Mobile app

```bash
cd mobile
npm install
npm run start
```

Supabase URL/publishable key are already wired in `app.json` (`expo.extra`).

## Repo layout

```
supabase/migrations/   Schema, RLS, Postgres functions (source of truth for the DB)
supabase/functions/    Edge Functions (Stripe + admin game creation)
game-engine/           Persistent worker driving the round timer + Realtime broadcast
mobile/                Expo/React Native client
```
