# Responsible Play, AML/KYC, and Tax Reporting Checklist

`[COUNSEL: this is an engineering/ops checklist derived from patterns common to
real-money skill-contest and DFS platforms, not a legal opinion on what's required for
Penny Pincher specifically. Confirm every threshold and requirement below.]`

## Responsible Play

Real-money skill contests with escalating stakes and a live tiebreaker are exactly the
kind of design that invites responsible-gaming scrutiny, independent of the
gambling-vs-skill classification question. Expect to need, before launch:

- Visible spend limits / self-exclusion tools (daily/weekly/monthly deposit caps a
  player can set on their own account).
- A cooling-off / self-exclusion request flow (temporary or permanent account
  suspension at the player's request).
- Clear in-app disclosure of the maximum possible spend per game
  (**$50.50** for the Flat-Rate Escalator mode, per the product design) before a player's
  first purchase.
- A link to problem-gambling resources (e.g., the National Council on Problem Gambling,
  1-800-522-4700) `[COUNSEL: confirm whether this is legally required or best-practice
  for a skill-classified product in your target states - it is often required for
  gambling-adjacent products even where the operator disputes the "gambling"
  classification].`

None of this is built yet. It should be scoped as its own workstream.

## AML / KYC

Stripe Connect performs its own KYC on connected accounts as part of onboarding, but the
platform should independently decide:

- **When** to require ID verification: at signup, at first deposit, or at first
  withdrawal (most platforms in this category gate it at first withdrawal, minimizing
  friction for players who never cash out, but this is a product/compliance decision, not
  a technical default).
- **Thresholds** for enhanced due diligence (e.g., unusually large single deposits,
  rapid deposit-then-withdraw patterns, structuring-like behavior just under a
  reporting threshold).
- **Recordkeeping**: the `wallet_ledger` table already gives an immutable audit trail of
  every credit/debit with a `stripe_ref`; confirm retention period requirements with
  counsel (this is likely years, not months).
- **Suspicious Activity Reporting**: `[COUNSEL: confirm whether the platform itself has
  any SAR/FinCEN obligations, or whether this sits entirely with Stripe as the money
  transmitter of record - this depends on the final entity/licensing structure from
  00-READ-ME-FIRST.md item 1.]`

## Tax Reporting

- US federal: `[COUNSEL: confirm 1099-MISC vs 1099-K thresholds and which form applies
  given the platform's role as either "payor of winnings" or a mere payment
  intermediary - this depends on the licensing structure.]` Currently the platform has
  no tax-form-generation workflow at all; this needs to exist before real payouts happen
  at any meaningful volume.
- Consider requiring a W-9 (or W-8BEN for non-US persons, if allowed at all - see
  eligibility/geofencing question) before a player's first withdrawal above
  `[COUNSEL: insert threshold]`.

## What to build once counsel answers the open questions above

1. `blocked_states` / `allowed_states` config (admin-editable, not hardcoded) enforced
   at signup and at each real-money action (deposit, round purchase, withdrawal).
2. Self-service spend limits and self-exclusion, surfaced in the wallet UI.
3. ID verification gate before first withdrawal, wired to whichever KYC provider
   counsel/ops selects.
4. Tax form collection + generation workflow tied to the payout engine.
5. An admin view (in the "internal command center") for AML-relevant account flags -
   see the compliance-monitoring item in the command-center scoping discussion.
