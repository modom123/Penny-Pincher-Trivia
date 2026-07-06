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
- **Desktop app** (`desktop/`): Electron shell around a `react-native-web` export of the
  *same* mobile codebase - one game client, three targets (iOS/Android/desktop).
- **Internal command center** (`command-center/`): React/Vite staff dashboard - game
  creation/monitoring/force-payout, question bank CRUD, financial ledger browser,
  compliance tools (anti-cheat review, account suspend, blocked-states config), support
  tickets + manual wallet adjustments, and live analytics counts. Gated by a
  `staff_roles`/`is_staff()` RBAC layer in Postgres (roles: admin/support/compliance/
  content_editor), with every privileged action written to `admin_audit_log`.
- **Marketing website** (`website/`): static landing page + hosted legal pages. No
  gameplay.
- **Legal/compliance** (`legal/`): compliance risk memo and draft ToS/Official Rules/
  Privacy Policy/AML checklist - **not legal advice**, needs review by gaming/gambling
  counsel before publication (see `legal/00-READ-ME-FIRST.md`).

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
node index.js --watch        # "Game Director": polls for pending games and runs them automatically
node index.js <gameId> ...   # or run specific game(s) directly
```

`--watch` mode (the default with no args) is real automation: it polls the `games`
table for `status = 'pending'` rows and starts each one's 100-round loop itself, no
human/script invocation needed per game - just create the game (via the command center
or `create-game` Edge Function) and the engine picks it up. It also runs Sudden Death
Overtime end-to-end when `payout_game` reports a tie: opens restricted overtime rounds,
waits them out, and re-checks the tie after each one until it pays out for real.

### 4. Mobile app

```bash
cd mobile
npm install
npm run start
```

Supabase URL/publishable key are already wired in `app.json` (`expo.extra`).

### 5. Desktop app

```bash
cd desktop
npm install
npm start   # builds a react-native-web export of mobile/ and launches Electron
```

See `desktop/README.md` for packaging/signing caveats (no code-signing configured yet).

### 6. Internal command center

```bash
cd command-center
cp .env.example .env   # Supabase URL + publishable key, same as mobile
npm install
npm run dev
```

Sign in requires a `staff_roles` row for that user (`admin`/`support`/`compliance`/
`content_editor`) - grant one via SQL, since staff role assignment is intentionally not
self-service:

```sql
insert into public.staff_roles (user_id, role) values ('<user-uuid>', 'admin');
```

### 7. Marketing website

Static site, no build step - see `website/README.md`.

## Repo layout

```
supabase/migrations/   Schema, RLS, Postgres functions (source of truth for the DB)
supabase/functions/    Edge Functions (Stripe + admin game creation)
game-engine/           Persistent worker driving the round timer + Realtime broadcast
mobile/                Expo/React Native client (iOS, Android, and web export)
desktop/               Electron shell wrapping the mobile app's web export
command-center/        Staff admin dashboard (React/Vite)
website/               Marketing site + hosted legal pages
legal/                 Compliance risk memo + draft legal documents
```
