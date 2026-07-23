# 01 — Product Ground Truth (code-audited 2026-07-23)

This document describes what the deployed system **actually does**, verified
line-by-line against the enforcement code (PostgreSQL functions and edge
functions in this repository). Where it contradicts the "Legal Clearance Intake
Package v2" PDF, this document is correct and the PDF is not. Counsel's opinion
should rest on these facts.

## Corrections to the intake package (material)

1. **Payments run on Stripe, not Trustly.** The PDF describes a completed
   Trustly migration; **no Trustly integration exists in the codebase**.
   Deposits (Stripe Checkout), withdrawals (Stripe Connect transfers), and
   identity verification (Stripe Identity) are all Stripe — and Stripe has
   classified the account as a restricted business, so the implemented rail is
   one that has declined to support the product at scale. A replacement rail
   (Trustly or a specialty real-money-gaming processor) is **planned, not
   built**. Questions that turn on "Trustly ID" KYC should be answered for the
   planned architecture and flagged accordingly.
2. **The §3.11 "weekly pool rollover" is not built.** As of 2026-07-23 the
   deployed behavior for a game ending with zero eligible winners is a
   **pro-rata refund**: the entire prize pool is returned to the players who
   funded it, proportional to each player's cash contribution, as withdrawable
   cash (not counted as winnings). The weekly rollover described in §3.11 is a
   design under consideration that we ask counsel to evaluate BEFORE it is
   built; refund is the current and fallback behavior.

## Contest mechanics (verified in code)

- Players buy tokens with real money; 1 token = $0.01 of in-game value. Bundles
  include bonus tokens ($5→600, $10→1,400, $20→3,000). Bonus ("promo") tokens
  are tracked separately, are playable but never withdrawable, and **never fund
  the prize pool**.
- A game runs up to 100 sequential multiple-choice trivia rounds under a
  server-enforced timer. Entering each round costs tokens; costs typically
  escalate by round. Server-side per-game min/max buy-in caps exist.
- Of each round entry's **cash** portion: 60% to that game's prize pool, 40%
  retained by the platform. The pool therefore can never exceed real dollars
  collected for that game.
- Scoring is server-authoritative (server clock, not client). Anti-cheat: 300ms
  minimum answer time, stricter (150ms/2-strike) in rounds 80+.
- A "streak" mechanic grants a free round after consecutive correct answers in
  one game mode.
- Tied leaders at the final round → live "Sudden Death Overtime" among the tied
  players only.
- Payouts use one of **four staff-assigned schemes** (field-scaled standard /
  fixed top-3 / winner-take-most / spread-the-wealth), disclosed in-app before
  entry. Shares are computed to sum exactly to the pool.
- **Zero eligible winners → full pro-rata refund of the pool** (see correction
  2 above).
- Winners are credited to their wallet; wallet cash (not promo) is withdrawable
  at any time subject to the gates below.

## Compliance controls (verified in code)

| Control | Verified state |
|---|---|
| Geographic gating | DB-enforced allowlist: buy-ins permitted ONLY from states on `allowed_states` (currently seeded CA, TX, OH, PA, MA, NJ, VA — an engineering default awaiting counsel), with a denylist override and a hard failure when no verified location exists. Staff-editable without an app release. |
| Location verification | Server validates a signed anti-spoof location token (Radar, HS256 JWT, expiry + fraud-check enforced) **when the vendor key is installed; the key is not yet installed**, so location is currently self-declared by testers. Public launch is gated on the key. |
| Geofence lock | One-way production lock: once engaged, location checks cannot be disabled by any staff account (removal requires direct database access). Built 2026-07-23; will be engaged before real-money launch. |
| Age/identity (KYC) | Withdrawals are blocked until identity is verified and 18+ confirmed. Deposits and play require only an email. Vendor is Stripe Identity today (see correction 1). |
| Tax | Lifetime winnings tracked per player; withdrawals lock at $550 lifetime pending confirmed tax details. **W-9 collection/1099 filing vendor is an open item** (Stripe Tax was the plan; Stripe is off the table). The current "confirm tax details" flow is a self-attestation stub. |
| Withdrawal integrity | Two-phase atomic reservation (no double-withdrawal under concurrency); cash-only (promo excluded). |
| Ledgers | Every deposit, round debit, payout, refund, withdrawal, and staff action is written to append-only ledgers/logs. |
| Responsible play | **Not built.** No deposit/spend limits, no self-exclusion or cooling-off, no problem-gambling resources. |
| Free entry | **None.** Every round costs tokens; there is no no-purchase-necessary alternate method of entry. |

## Distribution posture

Web/PWA only at launch. Google Play / Apple App Store real-money applications
will not be submitted until counsel's opinion exists to support them.
