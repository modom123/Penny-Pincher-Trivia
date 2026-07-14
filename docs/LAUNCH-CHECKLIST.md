# Penny Pincher — Pre-Flight Launch Checklist

Maps the go-live blueprint's four critical operational areas + the master checklist
to what's actually built in this repo, and what still needs a vendor account/key or a
human decision before real money and the public app stores are involved.

> **This is an engineering-readiness checklist, not a legal sign-off.** The whole
> real-money model still needs review by gaming/gambling counsel first — see
> `legal/00-READ-ME-FIRST.md`. Nothing below is legal advice.

## Legend
- ✅ **Built & enforced** — the enforcement lives in Postgres and can't be bypassed by a client.
- 🔌 **Built, needs vendor key** — code + integration point deployed; supply the vendor account/secret to activate.
- 🧑 **Needs a human/business decision** — not a coding task.

---

## 1. KYC & Identity Verification

| Item | Status | Where |
|---|---|---|
| Withdrawal blocked until identity verified + 18+ | ✅ | `reserve_withdrawal` raises `KYC_REQUIRED` / `AGE_REQUIREMENT` |
| Register + load funds with just email (KYC only gates withdrawal) | ✅ | KYC checked only in `reserve_withdrawal`, not signup/deposit |
| Vendor webhook to record verification result | 🔌 | `kyc-webhook` edge fn → `apply_kyc_result`; set `KYC_WEBHOOK_SECRET`, point Persona/Stripe Identity at it |
| Staff manual KYC review/override | ✅ | Command center → Compliance → KYC review (`admin_set_kyc_status`) |
| Choose the vendor (Persona vs Stripe Identity vs Identiq) | 🧑 | — |

## 2. Tax Compliance & 1099-MISC

| Item | Status | Where |
|---|---|---|
| Track lifetime winnings per player | ✅ | `payout_game` increments `profiles.lifetime_winnings_cents` |
| Lock withdrawals at $550 until tax details confirmed | ✅ | `reserve_withdrawal` raises `TAX_DETAILS_REQUIRED` |
| Player prompt + confirm-tax-details flow | ✅ (stub) | Mobile Wallet screen → "Confirm tax details" (`confirm_tax_details`) |
| Actual W-9 collection + 1099 filing | 🔌 | Turn on **Stripe Tax** in Stripe Connect; wire its hosted W-9 flow to call `confirm_tax_details` on completion |
| Confirm threshold is calendar-year vs lifetime for your tax treatment | 🧑 | Flagged `[COUNSEL]` in the migration |

## 3. Geo-Fencing & Jurisdictional Locking

| Item | Status | Where |
|---|---|---|
| Launch **whitelist**: play allowed ONLY in the whitelisted states | ✅ | `buy_round` enforces `platform_config.allowed_states`. **Soft launch = TX, CA** (narrowed via command center); NY/OH/PA queued for wider rollout. Every other region raises `REGION_BLOCKED` by default |
| Buy-in blocked in restricted states (denylist override) | ✅ | `buy_round` also honours `blocked_states` on top of the whitelist |
| Buy-in blocked when location never verified | ✅ | `buy_round` raises `LOCATION_REQUIRED` on null region |
| Admin-editable allow/block lists (no app release needed) | ✅ | Command center → Compliance → Allowed states (`admin_update_allowed_states`) + Blocked states (`admin_update_blocked_states`) |
| Device location ping on opening a game | ✅ | `geo-check` edge fn → `set_verified_region`; mobile calls it on GameScreen mount + RegionGate |
| Anti-spoof verified location (not raw client lat/lng) | ✅ / 🔌 | `geo-check` validates Radar's signed verified-location JWT (`RADAR_JWT_SECRET`, HS256), enforces `passed` + expiry, and reads the *verified* state. When the secret is set it **requires** a valid token (rejects self-declared regions). Remaining: install `react-native-radar` on device builds (`lib/radar.ts` hook + `RADAR_PUBLISHABLE_KEY`) and set `RADAR_JWT_SECRET` |
| Which states to block | 🧑 | `legal/01-state-restrictions.md` — needs counsel |

## 4. Customer Support & Dispute Desk

| Item | Status | Where |
|---|---|---|
| Black-box ledger of every timing event, 48h retention | ✅ | `websocket_logs` table; `submit_answer` logs accepted/rejected with server timing; `purge_old_websocket_logs` (run hourly by game-engine `--watch`) |
| Server-authoritative timing (never trust client clock) | ✅ | `submit_answer` uses `clock_timestamp()` vs `game_rounds.started_at` |
| Staff pull a player's log to adjudicate a dispute | ✅ | Command center → Support → Dispute desk (`staff_get_player_log`) |
| Tickets linked to a specific game/round | ✅ | `support_tickets.game_id` / `round_number` |
| Support-tool integration (Zendesk/Intercom) | 🧑/🔌 | Tickets live in `support_tickets`; wire an external desk if desired |

---

## Master pre-flight checklist (from the blueprint)

| Blueprint item | Status | Notes |
|---|---|---|
| Supabase DB schema live & indexed | ✅ | All migrations in `supabase/migrations/`, applied to `pkvdthwqvjpxhqorfpub` |
| Real-time game loop configured | ✅ | Supabase Realtime + `game-engine` worker (this build uses Realtime broadcast, not a raw Socket.io cluster) |
| Real-time game loop **deployed & running** | 🧑 | "Configured" ≠ "running": the worker is a persistent process with **no host anywhere in this repo**. `game-engine/Dockerfile` makes it deployable; you still need to point a host (Fly.io/Railway/Render/a VM) at it, or games created by the auto-scheduler just sit `pending` forever. See §5 below. |
| Redis leaderboard | 🧑 | Not used — leaderboard is computed in Postgres/`end_round`. Add Upstash Redis only if load demands it |
| Stripe Connect deposits live | 🔌 | `create-checkout-session` + `stripe-webhook` deployed; set `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` |
| ID verification hooked to withdrawals | ✅ / 🔌 | Enforced in DB; vendor webhook needs a key |
| Geo-fencing restricting banned states | ✅ / 🔌 | Enforced in DB; geo-vendor needs a key |
| 10k trivia questions | 🔌 | `generate-questions` (Trivia Alchemist) drafts for review; 100 placeholders seeded. Needs `ANTHROPIC_API_KEY` + human review to scale up |
| Fraud Sentinel millisecond trigger | ✅ | `submit_answer` — 300ms floor, 150ms/2-strike on rounds 80+ |

## Edge Function secrets to set before launch

Project Settings → Edge Functions → Secrets:

```
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_PUBLIC_URL   # payments
ANTHROPIC_API_KEY                                          # question drafting
KYC_WEBHOOK_SECRET                                         # KYC webhook auth
RADAR_JWT_SECRET                                           # geo verification: Radar Fraud "JWT Secret Key" (HS256). Setting it makes geo-check require a valid verified-location token
ADMIN_USER_IDS                                             # legacy create-game gate (command center uses staff_roles instead)
```

## ✅ Bonus-token economics — RESOLVED (cash/promo wallet split)

Token bundles grant **bonus tokens** (`$5 → 600`, `$10 → 1,300`, `$20 → 2,800`), and 1
token equals 1 cent of in-game / prize-pool value. Left unaddressed this created a cash-out
arbitrage (buy `$20 → 2,800`, never play, withdraw $28) and a pool-solvency hole (bonus
tokens inflating the prize pool above real USD collected). **Both are now closed** by the
cash/promo wallet split (migrations `20260707003220` → `20260707010300`):

- `profiles.promo_balance_cents` tracks the non-withdrawable bonus slice;
  **withdrawable cash = `wallet_balance_cents − promo_balance_cents`**.
- `credit_wallet_from_stripe(user, cash, bonus, event)` credits the cash paid as
  withdrawable and the bonus above it as promo (the `stripe-webhook` derives
  `bonus = tokens − priceCents`).
- `buy_round` spends **promo first**, and **only the cash portion funds the prize pool**
  (60/40) — so the pool never exceeds real USD collected.
- `reserve_withdrawal` draws **only** the cash-funded balance; a withdrawal that dips into
  bonus raises `INSUFFICIENT_WITHDRAWABLE`.
- `my_compliance_status` exposes `withdrawableCents` + `promoBalanceCents`; the mobile
  Wallet screen shows cash vs bonus separately.

Verified end-to-end against the live DB (promo-first spend, cash-only pool 30/20 from a
50c cash round, MIN/MAX buy-in gates, withdrawal cash-only, promo-locked, Stripe
idempotency). `[COUNSEL: bonus terms are still a disclosure/consumer-protection question —
see legal/02-terms-of-service-DRAFT.md §3.1.]`

### Per-game token buy-in limits
`games.min_buy_in_tokens` / `max_buy_in_tokens` are enforced in `buy_round`: a player must
**hold ≥ MIN** tokens to join a game (`MIN_BUYIN_REQUIRED`), and cumulative token spend in a
game may not exceed **MAX** (`MAX_BUYIN_REACHED`). Null = no limit. Set them at game creation.

## 5. "Best in class games" go-live pass (this session)

Ten-step pass through the whole game layer, each step verified end-to-end against
the live database (dozens of assertions, all cleaned up afterward) before being
applied. One real bug was caught and fixed *before* it could affect a real game
(milestone bonus eligibility off-by-one — see migration `20260707022000`).

| Item | Status | Where |
|---|---|---|
| Self-signup completes (email confirmation) | ✅ | You disabled "Confirm email" in Supabase Auth — verify a real signup now completes without a confirmation-link dead end |
| Repo matches production (was badly drifted: payout-scheme engine, redesigned skip system, milestone removal) | ✅ | `20260707019000_reconcile_production_state.sql` |
| Client Skip bug (was scored as a wrong answer, docking points) | ✅ fixed | `mobile` now calls `skip_round`, not `submit_answer` |
| Milestone Booster re-legalized (player-funded pool bonus, not platform-funded) | ✅ | `20260707020000` + `20260707022000` (eligibility fix); website + official rules copy updated to match |
| Auto-scheduler (games always available across all 3 modes) | ✅ built | `ensure_games_available`; **requires the engine worker to be deployed to actually run** (see §Real-time game loop above) |
| All 3 modes proven end-to-end (pricing, streak waiver, tiers, skip limits, ties→sudden death, payout schemes) | ✅ | 44/44 assertions — see conversation for detail |
| Anti-cheat staff visibility + eligibility reinstatement | ✅ | Command center → Compliance → "Grand-prize eligibility" |
| Payments (deposit split, webhook idempotency, 2-phase withdrawal, KYC/age/tax/Connect gates) | ✅ verified | 21/21 assertions; **zero real Stripe invocations have ever occurred** — confirm `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`APP_PUBLIC_URL` are set to **live** keys before flipping on real money (cannot be checked from here — secret values aren't readable, nor should they be) |
| Admin operator dashboard (engine health, live standings, config-backed scheduler) | ✅ | Command center → Games → "Operations" panel |
| Player history/stats | ✅ | Mobile Lobby → "Your recent games" |
| Web play deploy config | ✅ built | `mobile/netlify.toml`; **needs a second hosting site pointed at it** (separate from the marketing site) — website's "Play Now" button (`/app/`) won't resolve until that's live |

### Pre-launch smoke test (run once staging/prod hosts above are live)

1. Sign up a fresh account through the real app (not the admin-created demo account) — confirm it lands in the lobby with no confirmation-link dead end.
2. Command center → Games → Operations: confirm **Active & driven > 0** and **Active & stalled = 0** once games exist. Stalled > 0 for more than a poll interval means no healthy worker is running.
3. Buy a token bundle for real (small amount) → confirm the wallet updates within a few seconds of the Stripe redirect.
4. Join a live game, answer a few rounds, use Skip once, verify it doesn't dock points.
5. Force a small game to completion (`admin_force_payout`) and confirm a real payout lands in the winner's wallet.
6. Attempt a withdrawal on an unverified account → confirm `KYC_REQUIRED` blocks it as expected.
7. Command center → Compliance → confirm the allowed-states whitelist is set to the actual launch states, not empty.

## What is deliberately NOT automated (needs a human)

- Choosing/blocking states (legal call).
- Approving AI-drafted trivia before it goes live.
- Posting the Hype Machine's announcements (player-identity/consent call).
- Shifting real ad budgets (Campaign Commander is decision-support only).
- Auto-pushing payouts — withdrawals stay player-initiated through the KYC/tax-gated flow.
