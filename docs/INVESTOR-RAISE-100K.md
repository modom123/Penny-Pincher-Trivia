# Penny Pinching Trivia — Seed Raise Summary (DRAFT)

**The ask:** $100,000 for 10% of the company · $1.0M post-money ($900k pre-money)
**Prepared:** 2026-07-23 · Confidential — for discussion with prospective investors

> Not an offer to sell securities. Any investment will be made only through
> definitive documents prepared by counsel, to eligible investors, under an
> applicable securities-law exemption. See "Structure & legal" below.

---

## 1. What it is

Penny Pinching Trivia is a **real-money, skill-based trivia contest** — players
pay per round to compete in fast, timed trivia for a cash prize pool. The
operator keeps a **40% rake** on every cash entry; 60% funds the prize pool. The
legal/business model mirrors daily-fantasy-sports and skill-gaming apps:
pay-to-enter, cash prize, **skill-predominant** rather than chance-based.

## 2. Why now — the platform is already built

This is not a pre-product raise. The core platform is engineered and running:

- Full game engine: up to 100 timed rounds, four payout schemes, sudden-death
  tiebreaker, streak mechanic, server-authoritative scoring + anti-cheat.
- Money controls enforced in the database (cannot be bypassed by a client):
  cash/promo wallet split, 60/40 pool math, atomic withdrawals, immutable
  ledgers.
- Compliance scaffolding: state allowlist geofencing, KYC-gated withdrawals,
  age-gating, tax-threshold lock, one-way geofence production lock.
- Staff Command Center + player mobile app.
- A gaming-counsel pre-research package prepared to accelerate legal clearance.

The money is not to build the product — it's to **clear the legal and payment
gates that unlock real-money revenue.**

## 3. Use of the $100k

Mapped to the go-live audit gates (`docs/GO-LIVE-AUDIT-2026-07-23.md`):

| Use | Est. | Why |
|---|---|---|
| Gaming/gambling legal clearance (7-state, review-and-verify) | $25k–$40k | The gate to accepting real money; opinion letter unlocks processors + app stores |
| Trustly payment integration + KYC (replace legacy code) | $10k–$20k | The bank-to-bank rail the product runs on; must be built + verified |
| Tax vendor (W-9 / 1099 e-file) + responsible-play tooling | $8k–$15k | Required before winners scale; limits, self-exclusion, RG links |
| Radar anti-spoof geolocation + KYC vendor keys/usage | $3k–$8k | Turns the geofence from self-declared into enforced |
| Runway: infra, question bank build, soft-launch ops, buffer | remainder | ~TX+CA invite-only soft launch through first public states |

**Milestone this buys:** counsel-cleared launch in the first states, Trustly
live, and a controlled soft launch — the point at which the **40% rake starts
funding further expansion** (additional states, app-store submission) without
more outside capital.

## 4. The model & upside

- **Revenue = 40% of every cash entry.** In a 100-round game, entries escalate,
  so rake scales with engagement, not just headcount.
- **Bootstrap-to-revenue path:** the plan is to fund state expansion and
  app-store distribution out of the rake after the first cleared states (see
  `docs/LAUNCH-PLAN-7-STATES.md`), keeping dilution low.
- **Market:** the skill-contest / DFS-style category is large and established;
  the differentiator is trivia (a cleaner skill pedigree than sports-outcome
  DFS) at low, escalating micro-entry price points.

## 5. Risks (stated plainly)

- **Regulatory classification** is unresolved until counsel opines — the #1 risk;
  this raise funds resolving it. Some states will be permanently excluded.
- **Payment processor:** Stripe already restricted the account; Trustly (or a
  specialty gaming processor) must confirm and hold. A second rail is being
  identified as backup.
- **Execution:** Trustly integration, tax, and responsible-play tooling are not
  yet complete.
- Pre-clearance, pre-revenue: this is an early, high-risk investment.

## 6. Structure & legal (to be set by counsel)

- **$100k for 10% implies a $1.0M post-money valuation.** At this stage this is
  most commonly done as a **SAFE** (e.g., a $1.0M post-money cap) rather than a
  priced round, to keep legal cost and complexity down; a priced round is the
  alternative. The instrument and valuation are a negotiation, not a fixed term.
- Any raise is a **securities transaction** — it must use a valid exemption
  (typically **Reg D to accredited investors**), with proper disclosures and
  documents prepared by **securities counsel**. This is separate from the gaming
  counsel work and should not be skipped.
- Given the regulated, pre-clearance nature of the business, be transparent with
  investors that the funds are, in significant part, buying the legal clearance
  the business depends on.

## 7. What a prospective investor should ask to see

- The go-live audit and gated checklist (`docs/GO-LIVE-AUDIT-2026-07-23.md`).
- The 7-state launch plan (`docs/LAUNCH-PLAN-7-STATES.md`).
- The counsel pre-research package (`legal/counsel-package/`).
- A live demo of the platform (sandbox).

---

*Prepared with AI assistance. Not legal, tax, or investment advice. Valuation and
terms are illustrative and subject to negotiation and counsel review.*
