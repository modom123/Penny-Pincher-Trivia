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

## Game modes

Set at game creation (`games.mode` enum), same underlying engine for all three:

- **Flat-Rate Escalator** - round *N* costs *N* cents. The original design.
- **Streak Saver** - a correct answer waives the *next* round's entry fee entirely;
  a wrong answer resumes normal pricing. Average spend is lower, but "play free if
  you're right" is a stronger virality hook.
- **Milestone Booster** - flat per-tier pricing (Bronze 1-25 / Silver 26-50 / Gold
  51-75 / Platinum 76-100), plus a platform-funded $5 bonus injected into the prize
  pool at rounds 25/50/75. **Flagged in `legal/03-official-rules-DRAFT.md`**: a
  platform-funded (not just entry-fee-funded) bonus may raise its own sweepstakes-
  classification question - get counsel's sign-off before enabling this mode for real
  money.

**Sudden Death Overtime**: if 2+ players are tied for a top-3 finish at round 100,
`payout_game` doesn't pay out - it opens overtime rounds (flat $1 fee, shrinking timer
starting at 10s, restricted to the tied players only) until scores diverge, then pays
out for real. The game-engine's `--watch` mode runs this loop automatically.

## Scoring

Computed server-side in `submit_answer` (the server clock is authoritative, never the
client's):

- **Correct answer**: `round × 10` (base) `+` time bonus (milliseconds left on the
  clock). Later rounds and faster answers are worth more.
- **Wrong answer**: penalty of `−(round × 10)` — a wrong answer on round 80 costs far
  more than on round 1, mirroring the reward. No time component on the penalty.
- **Total score is floored at 0** — deductions can't push a player negative.
- **Risk premium (Streak Saver)**: a round you *paid* real cash to enter (broke your
  streak) earns `1.5×` the base points if correct — you put capital on the line. Free
  (streak) rounds earn base `1.0×`. Lets a player who fell behind buy their way back into
  contention by playing perfectly under higher stakes.
- **Tie-breaker — Wallet Efficiency Rating (WER)**: identical scores are broken by
  `total_score / cents_spent / total_response_ms` — more points per cent, and faster,
  wins. Sudden Death Overtime now only triggers on a true dead heat (equal score *and*
  equal WER).

## Running out of tokens

The wallet never goes negative. When you can't afford the next round's entry cost
(`buy_round`):

- **Rounds 1–30 (top-up window)**: you're blocked with `TOP_UP_REQUIRED` but *not*
  eliminated — add funds and continue. The mobile app routes you to the Wallet.
- **Round 31+ (window closed)**: the first round you can't afford ends your game —
  you're marked `is_eliminated` and dropped from prize contention (`buy_round` returns
  `gameOver: true`). The top-up cutoff is the `v_top_up_window_last_round` constant (30).

> Note: this "pause to top up" rule is enforced correctly at the DB layer, but the live
> game loop advances rounds on a shared countdown — so in the real-time modes a player
> realistically needs to top up *between* games or very fast, not mid-countdown. Worth
> confirming the intended pacing (turn-based vs. live) for the top-up flow to feel fair.

## Anti-cheat

- The server's clock is the only source of truth for timing - `submit_answer` computes
  elapsed time from `game_rounds.started_at` via `clock_timestamp()`, never from a
  client-reported timestamp, and rejects anything submitted after
  `time_limit_seconds + 500ms`.
- Answers faster than 300ms are flagged (`cheat_flags`); after 3 flags in one game, the
  player is disqualified from the prize pool (but can keep playing).
- Rounds 80+ get a stricter 150ms bar and only need 2 flags to disqualify - answering a
  high-difficulty, high-value question that fast is a much stronger bot signal than
  doing it on an early round.

## Go-live compliance layer

Four operational areas required before real money / public app stores. The
**enforcement lives in Postgres** so it can't be bypassed by a client; vendor
integrations are pluggable webhook/config points. Full status map in
[`docs/LAUNCH-CHECKLIST.md`](docs/LAUNCH-CHECKLIST.md).

- **KYC**: `reserve_withdrawal` blocks any payout until `kyc_status = 'verified'`
  and the player is 18+. `kyc-webhook` edge fn records vendor results
  (Persona/Stripe Identity) via `apply_kyc_result`; staff can manually review in
  the command center's Compliance page. Registration and deposits need only an
  email — KYC gates *withdrawal*, not entry.
- **Tax**: `payout_game` tracks `lifetime_winnings_cents`; `reserve_withdrawal`
  locks withdrawals at $550 until the player confirms tax details (Stripe Tax's
  W-9 flow → `confirm_tax_details`), keeping ahead of the $600 1099-MISC threshold.
- **Geo-fencing**: `buy_round` blocks buy-ins from `platform_config.blocked_states`
  (admin-editable in the command center) and from unverified locations. The
  `geo-check` edge fn records the device's verified region (Radar.io/GeoComply).
- **Black-box dispute ledger**: `websocket_logs` records every answer's
  server-observed timing (48h retention, purged hourly by the game-engine). Support
  staff pull a player's log in the command center's Dispute desk to adjudicate
  "my answer didn't submit" disputes with the exact server-side timing.

## Workforce (AI-assisted operations)

Modeled on a 6-role "autonomous AI employee" design doc, but scoped down deliberately:
anything that moves real money or publishes a real player's identity does so with a
human in the loop, not blind autonomy.

| Role | What's built | Why scoped this way |
|---|---|---|
| **Game Director** | `game-engine --watch` polls for pending games and runs their full 100-round + Sudden Death Overtime loop automatically. | Purely mechanical - no money/identity decisions, safe to fully automate. |
| **Fraud Sentinel** | Round-aware anti-cheat (see above), surfaced in the command center's Compliance page for staff review/action. | Flags for human review; doesn't auto-ban - a fast answer is a signal, not proof. |
| **Ledger Master** | `Financials` page reconciliation check: verifies debits+bonuses == pool+cut and payouts == pool, to the cent. | Reconciliation is safe to automate (read-only math). Real Stripe payouts stay player-initiated via the existing withdraw flow - auto-pushing money out without a withdrawal request sidesteps the KYC/consent flow already built. |
| **Trivia Alchemist** | `generate-questions` Edge Function drafts questions via an LLM into `question_drafts`; command center's Question Bank has a review/approve/reject UI. | Never writes to the live question bank directly - there's no automated fact-checking pass (would need a separate knowledge-base integration), so human review is the actual safety mechanism. |
| **Hype Machine** | Command center's Games page drafts a post-game announcement from real payout data. | Draft only, not auto-posted - no social API keys are wired up, and publishing a real player's identity + winnings without their consent is a consent/ToS judgment call, not something to automate blindly. |
| **Campaign Commander** | Analytics page shows revenue/volume per game mode. | Explicitly **not** automated - shifting real ad budgets across Meta/Google Ads is spending real money without human approval, which is out of scope here regardless of how confident an "optimizer" claims to be. |

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
- `ANTHROPIC_API_KEY` (used by `generate-questions` to draft trivia questions for
  staff review - see "Workforce" below)
- `KYC_WEBHOOK_SECRET` (shared secret for the `kyc-webhook` receiver - Persona/Stripe Identity)
- `RADAR_SECRET_KEY` (optional; anti-spoof location verification in `geo-check`)

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
