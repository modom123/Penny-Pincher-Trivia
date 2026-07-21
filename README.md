# Penny Pincher Trivia

A 100-round progressive trivia game: round *N* costs *N* tokens (1 token = 1 cent) to
enter, the prize pool grows as players unlock rounds, and the top finishers at round 100
split 60% of the pool; the platform keeps the other 40%. Paid places scale with the field
(`compute_payout_shares`): under 15 players pays the top 3 (50/30/20), 15–39 the top 5,
and 40+ pays roughly the top 10%.

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
- **Web MVP (soft launch)**: the same mobile codebase also exports to a responsive
  browser app (`cd mobile && npm run build:web` → static `mobile/web-build/`). This is
  Step 2 of the launch playbook — players in TX/CA open it in Safari/Chrome, sign in,
  fund their wallet via Stripe, and play, with no app-store review. See
  [Web MVP deployment](#web-mvp-soft-launch-deployment).
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

## Questions, subjects & difficulty

- **Subjects**: a 500-subject taxonomy (25 domains × 20) lives in the `subjects` table,
  authored in `question-curator/taxonomy.js`. Questions and drafts carry a `subject_id`.
- **Difficulty = school grade**: 20 levels, one grade per level, starting at 3rd grade
  and going up a grade each level → `grade_level` **3–22** (3–12 school, 13–16 college,
  17–22 graduate/expert). A 100-round game spends 5 rounds per grade level (20 × 5 = 100);
  round → grade is the `round_grade_level(round)` function.
- **Bank target**: 500 questions per subject = 25 at each grade level. Single-subject
  games fill via `create_game_for_subject(subject_id)`; coverage is reported by
  `subject_curation_status()`.
- **Curator engine** (`question-curator/`): batch-generates the bank as *reviewable
  drafts* (never straight to live), idempotent/resumable, with dedup + shape validation.
  `make-contest.js` is the lean per-tournament path (100 questions on demand → publish).
  See `question-curator/README.md`. Human approval via `promote_question_draft` is still
  the fact-checking step.
- **Command center**: the Question Bank page shows per-subject **curation coverage**
  (`subject_curation_status()`); the Games page can **publish a themed contest** from any
  contest-ready subject (`admin_create_subject_contest` → `create_game_for_subject`).

## Design & UI

The mobile client follows the game-design brief: a midnight dark theme with Electric
Emerald (money/growth) and Neon Gold (jackpot/top-3) accents, shared via
`mobile/src/theme.ts`. Three core screens:

- **Lobby** — Penny Wallet top bar (balance + quick deposit) and live game cards
  (mode, subject, prize pool, round).
- **Active Arena** (`GameScreen`) — live prize-pool header, 1–100 progress tracker,
  question card with a shrinking 12-second countdown, micro-debit "Unlock Round N
  ($0.42)" action, and emerald/crimson answer feedback.
- **Climax** (`ResultsScreen`) — gold/silver/bronze podium for the top 3, then the full
  payout list.

## Game modes

Set at game creation (`games.mode` enum), same underlying engine for all three:

- **Flat-Rate Escalator** - round *N* costs *N* cents. The original design.
- **Streak Saver** - a correct answer waives the *next* round's entry fee entirely;
  a wrong answer resumes normal pricing. Average spend is lower, but "play free if
  you're right" is a stronger virality hook.
- **Milestone Booster ("Treasure Hunt")** - same per-round pricing as the Escalator
  (round *N* costs *N* cents). Every 10th round from round 10 through round 90 is a
  **clue**: answer it correctly and it earns an escalating multiplier of that round's
  own cost (multiplier = round ÷ 10, so round 20 = 2× its 20¢ cost = 40¢, round 90 = 9×
  its 90¢ cost = $8.10) - nothing is credited yet. Round 100 is the **final answer**:
  answer it correctly and every clue collected during the game is paid out in one lump
  sum as non-withdrawable bonus tokens (up to $28.50 if all 9 are collected); answer it
  incorrectly and the whole collected total is forfeited - no payout at all. Missing a
  clue round (10-90) just forfeits that one clue, no other penalty. See
  `20260721010000_milestone_booster_treasure_hunt.sql` (supersedes the simpler
  per-round credit/clawback in `20260721000000_milestone_booster_bonus_rounds.sql`).
  The prize pool is funded **solely by player entry fees** (60/40), the same as the
  other modes; the Treasure Hunt payout never touches it. An earlier design added
  a platform-funded $5 bonus at rounds 25/50/75; that was **removed** (migration
  `20260709000000_milestone_booster_drop_platform_bonus.sql`) because a platform-funded
  prize could raise its own sweepstakes-classification question - the Treasure Hunt
  mechanic here is deliberately structured like the "3 the hard way" streak bonus (see
  Wallet section below) to stay on the safe side of that line: player-funded
  bonus-token movement only, never platform cash.

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
- **No pay-to-win**: points come only from answering correctly. There is no bonus for
  paying cash to enter a round — a wrong answer is never rewarded, only ever penalized.
- **Tie-breaker — least cash spent**: identical scores are broken by the player who spent
  *less* (`order by total_score desc, total_cash_spent_cents asc`) — pure skill on the
  scoreboard, frugality decides the tie. This is the "penny pincher" edge: same trivia
  score, the player who dropped fewer cents on mistakes wins. Sudden Death Overtime only
  triggers on a true dead heat (equal score *and* equal cash spent). Read it via the
  `get_game_leaderboard(game_id)` RPC.

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

## Wallet: cash vs bonus tokens

Token bundles grant bonus tokens (`$1 → 100`, `$5 → 600`, `$10 → 1,400`, `$20 → 3,000`,
`$50 → 7,000`).
1 token = 1 cent of in-game value, so the wallet is split so bonuses can't be cashed out or
inflate real payouts:

- `profiles.wallet_balance_cents` is the **total** spendable balance (cash + bonus);
  `profiles.promo_balance_cents` is the non-withdrawable bonus slice.
  **Withdrawable cash = `wallet_balance_cents − promo_balance_cents`.**
- `credit_wallet_from_stripe(user, cash, bonus, event)` credits the cash paid as
  withdrawable and the bonus above it as promo (the webhook derives `bonus = tokens −
  priceCents`; idempotent on the Stripe event id).
- `buy_round` spends **promo first**, and **only the cash portion funds the prize pool**
  (60/40) — the pool can never exceed the real USD collected.
- `reserve_withdrawal` draws **only** cash; dipping into bonus raises
  `INSUFFICIENT_WITHDRAWABLE`.
- **"3 the hard way" streak bonus** (all modes, always on): once a player answers 3
  rounds in a row correctly, every correct answer after that credits the round's cost
  right back to their balance as bonus tokens, for as long as the streak holds — one
  wrong answer resets it to zero. Bonus-only: never touches cash or the prize pool. See
  `20260718040000_streak_bonus_the_hard_way.sql`.
- **Per-game buy-in limits**: `games.min_buy_in_tokens` (must *hold* ≥ MIN to join —
  `MIN_BUYIN_REQUIRED`) and `games.max_buy_in_tokens` (cumulative token-spend cap —
  `MAX_BUYIN_REACHED`); null = no limit.

## Web MVP (soft launch) deployment

The launch playbook does a **web MVP first** (real revenue + load-testing with local
TX/CA players before app-store review). The player web app is the mobile Expo codebase
exported for the browser:

```bash
cd mobile
npm install
npm run build:web        # -> static site in mobile/web-build/
```

Host `mobile/web-build/` on any static host (Vercel/Netlify/Cloudflare Pages/S3) at
e.g. `pennypincher.app`. Then:

- Set the `create-checkout-session` edge function's `APP_PUBLIC_URL` secret to that
  origin so Stripe's success/cancel URLs return players to the app. On web the Wallet
  screen sends players straight to Stripe Checkout and syncs the credited balance back
  on return (webhook → Realtime).
- **Region**: the app shows a location gate (`RegionGate`) so a verified soft-launch
  tester can declare TX/CA, which calls `geo-check` → `set_verified_region`. This is a
  **pre-Radar stopgap** for the controlled soft launch only — wire `RADAR_SECRET_KEY` +
  the vendor SDK before the public app-store launch, since `buy_round` is the hard
  enforcement point regardless.
- The dev self-credit button is hidden on web. `dev_credit_wallet` is also locked
  down server-side: **admin staff only**, and it credits the non-withdrawable **promo**
  balance (never withdrawable cash), so it can't be used to mint cashable money.

The same `web-build` is what the Electron desktop shell wraps, so desktop and web stay
in lockstep with iOS/Android.

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
- **Geo-fencing (launch whitelist)**: `buy_round` allows buy-ins **only** from the
  states in `platform_config.allowed_states` (seeded to the launch set **TX, CA, NY,
  OH, PA**) — every other region raises `REGION_BLOCKED` by default. `blocked_states`
  is an additional denylist override, and unverified locations raise
  `LOCATION_REQUIRED`. Both lists are admin-editable in the command center's
  Compliance page (`admin_update_allowed_states` / `admin_update_blocked_states`); the
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
