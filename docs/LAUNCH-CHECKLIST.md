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
| Buy-in blocked in restricted states | ✅ | `buy_round` raises `REGION_BLOCKED` (reads `platform_config.blocked_states`) |
| Buy-in blocked when location never verified | ✅ | `buy_round` raises `LOCATION_REQUIRED` on null region |
| Admin-editable blocked-states list (no app release needed) | ✅ | Command center → Compliance → Blocked states (`admin_update_blocked_states`) |
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

## ⚠️ Bonus-token economics — MUST resolve before real payments

Token bundles grant **bonus tokens** (`$5 → 600`, `$10 → 1,300`, `$20 → 2,800`), but
1 token still equals 1 cent of in-game and prize-pool value, and the wallet is currently
withdrawable 1:1. As built, that creates two real problems:

1. **Cash-out arbitrage** — a player could buy `$20 → 2,800` tokens, never play, and
   withdraw $28.00. Free money out of the platform's pocket.
2. **Pool solvency** — bonus tokens spent into rounds inflate the prize pool (denominated
   in token-cents) above the real cash actually collected, so paying out 60% of the pool
   can exceed the real USD taken in.

**Recommended fix before enabling real deposits/withdrawals:** split the wallet into
`purchased_balance` (cash-funded, withdrawable) and `promo_balance` (bonus tokens,
play-only, non-withdrawable); spend promo first, and have `reserve_withdrawal` draw only
from the purchased/cash-funded portion. This is a schema + `buy_round`/`reserve_withdrawal`
change — flagged here rather than silently shipping the arbitrage. `[COUNSEL: also a
disclosure/consumer-protection question — see legal/02-terms-of-service-DRAFT.md §3.1.]`

## What is deliberately NOT automated (needs a human)

- Choosing/blocking states (legal call).
- Approving AI-drafted trivia before it goes live.
- Posting the Hype Machine's announcements (player-identity/consent call).
- Shifting real ad budgets (Campaign Commander is decision-support only).
- Auto-pushing payouts — withdrawals stay player-initiated through the KYC/tax-gated flow.
