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
| Launch **whitelist**: play allowed ONLY in TX, CA, NY, OH, PA | ✅ | `buy_round` enforces `platform_config.allowed_states` (seeded to the 5 launch states); every other region raises `REGION_BLOCKED` by default |
| Buy-in blocked in restricted states (denylist override) | ✅ | `buy_round` also honours `blocked_states` on top of the whitelist |
| Buy-in blocked when location never verified | ✅ | `buy_round` raises `LOCATION_REQUIRED` on null region |
| Admin-editable allow/block lists (no app release needed) | ✅ | Command center → Compliance → Allowed states (`admin_update_allowed_states`) + Blocked states (`admin_update_blocked_states`) |
| Device location ping on opening a game | 🔌 | `geo-check` edge fn → `set_verified_region`; mobile calls it on GameScreen mount |
| Anti-spoof verified location (not raw client lat/lng) | 🔌 | Set `RADAR_SECRET_KEY`; replace the placeholder in `geo-check` with the Radar.io/GeoComply verify call |
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
RADAR_SECRET_KEY                                           # geo verification (optional until anti-spoof needed)
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

## What is deliberately NOT automated (needs a human)

- Choosing/blocking states (legal call).
- Approving AI-drafted trivia before it goes live.
- Posting the Hype Machine's announcements (player-identity/consent call).
- Shifting real ad budgets (Campaign Commander is decision-support only).
- Auto-pushing payouts — withdrawals stay player-initiated through the KYC/tax-gated flow.
