# Final System Audit — Real-Money Go-Live (2026-07-23)

Full-repo audit of enforcement code (Postgres functions), edge functions, game
engine, mobile client, and command center, checked against the Legal Clearance
Intake Package v2 (2026-07-23) and `docs/LAUNCH-PLAN-7-STATES.md`.

## Verdict: NOT ready to accept real money. 5 blockers, 4 high-priority gaps.

The core enforcement architecture is genuinely solid — every money-touching rule
lives in Postgres behind `security definer` functions a client cannot bypass. But
the payment rail is contradicted by its own processor, two features the legal
package describes as "Built" do not exist in this repo, and the vendor keys that
turn paper controls into real ones are not set.

---

## 1. Verified BUILT and enforced (audited, not just claimed)

| Control | Where verified |
|---|---|
| Geofence allowlist, whitelist-primary + denylist override, DB-enforced | `buy_round` (`20260718000000`) — `REGION_BLOCKED` / `LOCATION_REQUIRED` |
| Anti-spoof location: Radar JWT (HS256) validated server-side; when `RADAR_JWT_SECRET` is set a valid, passing, unexpired token is REQUIRED | `geo-check/index.ts` |
| Withdrawal gates: KYC verified + 18+ + tax-details lock at $550 + cash-only (promo not withdrawable) | `reserve_withdrawal` (`20260707010100`) |
| Two-phase withdrawal (atomic reserve → transfer → settle/refund; no double-spend under concurrency) | `withdraw/index.ts` |
| Cash/promo wallet split; prize pool funded ONLY by cash portion (pool can never exceed real USD collected) | `buy_round` 60/40 on `v_cash_used` |
| Payment webhook idempotency | `stripe-webhook` passes `p_stripe_event_id` |
| Four payout schemes (standard / classic_top3 / winner_take_most / spread_the_wealth), shares sum exactly to pool | `20260713030000_payout_schemes.sql` |
| Sudden-death tiebreaker on tied paid places | `payout_game` |
| Server-authoritative answer timing + fraud floor (300ms; 150ms/2-strike rounds 80+) | `submit_answer` |
| Immutable audit trails: `wallet_ledger`, `websocket_logs` (48h), `log_admin_action` | multiple |
| Staff roles + locked-down dev credit function | `20260707012000` |
| Buy-in min/max caps per game; top-up window cutoff (round 30) | `buy_round` |

## 2. CRITICAL discrepancies: legal package v2 vs. this codebase

These must be resolved before the package goes to counsel — counsel clearing a
described system that differs from the deployed one produces a worthless opinion.

1. **Payments: package says Trustly, code is 100% Stripe.** There is zero Trustly
   code in this repo. `create-checkout-session`, `stripe-webhook`,
   `connect-onboarding`, `withdraw` (Stripe Connect transfers), and
   `create-identity-verification` (Stripe Identity) are all Stripe. Per the
   package, **Stripe has already classified this account as a restricted
   business** — meaning the only payment rail actually implemented is one that
   has refused the business at scale. KYC is likewise described as "Trustly ID"
   but implemented as Stripe Identity, so the KYC vendor is lost together with
   the payments vendor.
2. **§3.11 no-winner pool rollover: claimed "Built (new)" — NOT built.** Audited
   `payout_game`: with zero eligible winners it computes an empty share list,
   pays nobody, and marks the game `completed`. **The prize pool is silently
   orphaned** in `games.total_prize_pool_cents` — player money in, no payout, no
   rollover, no refund. (The game engine's "rollover" at `game-engine/index.js:364`
   is a registration-window rollover for under-filled games — a different thing.)
3. **§3.10 payout schemes: confirmed built** (the one "new" claim that checks out).

## 3. Go-live checklist — accepting real money

Ordered as gates: every item in a gate must be ✅ before the next gate matters.
Owner key: 🧑 business/legal decision · 🔧 engineering · 🔑 vendor account/key.

### GATE A — Truthful ground truth (do first, this week)

- [ ] 🔧 Correct the Legal Clearance Package v2 to match reality: payments/KYC are
      Stripe-implemented-but-restricted (Trustly is a plan, not a build), and the
      §3.11 rollover is designed but not implemented. Never send counsel a
      description of a system that doesn't exist.
- [x] 🔧 ~~Fix the orphaned-pool bug~~ **DONE 2026-07-23**
      (`20260723010000_zero_winner_pool_refund_and_geofence_lock.sql`): a
      zero-winner game now refunds its pool pro-rata by each player's cash
      contribution (`pool_refund` ledger entries, withdrawable cash, winnings
      counter untouched). The §3.11 weekly rollover may replace this after
      counsel review; refund remains the fallback.

### GATE B — Payment rail (existential blocker)

- [ ] 🧑 Choose the rail: build the Trustly integration described in the package,
      or engage a specialty real-money-gaming processor. Stripe is not an option
      — the account is restricted.
- [ ] 🔧 Implement + deploy: deposits (replaces `create-checkout-session` +
      `stripe-webhook`), withdrawals (replaces Stripe transfer in `withdraw`),
      KYC result flow (replaces Stripe Identity → `apply_kyc_result`). Keep the
      existing two-phase reserve/settle/refund and event-idempotency patterns.
- [ ] 🔑 Written underwriting confirmation from the chosen processor for
      real-money skill gaming BEFORE scaling volume (§3.8 lesson).
- [ ] 🧑 Replacement tax vendor selected (Stripe Tax is gone with Stripe): W-9
      collection wired to `confirm_tax_details` (currently a self-attest stub),
      1099 filing plan confirmed with counsel. Must be live before any player
      approaches the $550 lock.
- [ ] 🧑 Segregated bank account for player funds (wallet balances + open prize
      pools) separate from operating revenue.

### GATE C — Legal clearance (Phase 1 of the launch plan)

- [ ] 🧑 Engage gaming/gambling counsel with the CORRECTED package; scope = the
      7 launch states (CA, TX, OH, PA, MA, NJ, VA).
- [ ] 🧑 Written skill-vs-gambling determination + per-state clearance in hand.
- [ ] 🧑 Counsel-approved Terms of Service, Official Rules, Privacy Policy
      (drafts in `legal/02–04` have `[COUNSEL:]` markers ready).
- [ ] 🧑 Counsel answers on: no-purchase-necessary entry (none exists — every
      round costs tokens), responsible-play requirements per state, rollover
      design constraints (§3.11 cap), $550 tax-lock threshold correctness.
- [ ] 🔧 Remove any state counsel declines from `allowed_states` before launch.

### GATE D — Enforcement keys & known gaps

- [ ] 🔑 `RADAR_JWT_SECRET` set + `react-native-radar` installed on device builds.
      **Until this is done, location is self-declared and the geofence is
      cosmetic** — acceptable for invite-only testers, disqualifying for public
      real money.
- [ ] 🔑 KYC vendor key live end-to-end (per Gate B vendor) — test verified,
      rejected, and underage paths.
- [ ] 🔧 Responsible-play minimums per counsel: deposit/spend limits,
      self-exclusion + cooling-off, problem-gambling resource link. **Currently
      none of this exists in the codebase** (audited: no matching schema or UI).
- [x] 🔧 ~~Lock the geofence master switch~~ **DONE 2026-07-23** (same
      migration): `admin_lock_geofence()` is a one-way production lock (admin
      role, Command Center button) that forces geofencing on;
      `admin_update_geofence_enabled(false)` raises `GEOFENCE_LOCKED` while
      locked; no unlock path exists for authenticated users (service-role SQL
      only). **Operational step remaining: press the lock before real money.**
- [ ] 🔧 Real question bank at launch depth (100 placeholder questions seeded;
      target per blueprint is 10k human-reviewed).

### GATE E — Operational readiness

- [ ] 🔧 Apply pending migrations to the live DB (including
      `20260723000000_seven_state_launch_allowlist.sql` — live DB still has the
      old TX/CA/NY/OH/PA list with NY in it).
- [ ] 🔧 All edge-function secrets set and verified in production (see
      `docs/LAUNCH-CHECKLIST.md` secret list, minus the Stripe entries Gate B
      replaces).
- [ ] 🔧 End-to-end money drill on production rails with staff accounts: deposit
      → play → win → KYC → withdraw → funds arrive; plus the failure paths
      (KYC-rejected, blocked state, tax-locked, processor-down refund).
- [ ] 🧑 Dispute desk + support rota staffed; game-engine heartbeat/lease
      monitoring alerting someone.
- [ ] 🧑 Incident runbook: how to pause buy-ins globally (game review gate),
      freeze withdrawals, and roll back a bad game payout.

### GATE F — Soft-launch entry criteria (Phase 2)

- [ ] Allowlist narrowed to TX + CA; invite-only cohort; low per-game
      `max_buy_in_tokens`; deposit ceiling if counsel recommends one.
- [ ] Exit to Phase 3 only on: ≥20 clean games, ≥10 real withdrawals paid, zero
      unresolved compliance incidents (per `docs/LAUNCH-PLAN-7-STATES.md`).

---

## 4. Bottom line

The Postgres enforcement core would pass a technical audit today. What blocks
real money is everything around it: **no viable payment processor** (the single
biggest item — nothing else matters until Gate B closes), **an orphaned-pool bug**
that strands player funds, **no counsel sign-off**, **a cosmetic geofence until
the Radar key ships**, and **no tax or responsible-play machinery**. Gates A–B
are actionable immediately and in parallel with the Gate C counsel engagement.
