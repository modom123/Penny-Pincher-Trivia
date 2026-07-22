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

Trustly performs its own KYC (Trustly ID) as part of the bank-linking flow, but the
platform should independently decide:

- **When** to require ID verification: at signup, at first deposit, or at first
  withdrawal (most platforms in this category gate it at first withdrawal, minimizing
  friction for players who never cash out, but this is a product/compliance decision, not
  a technical default).
- **Thresholds** for enhanced due diligence (e.g., unusually large single deposits,
  rapid deposit-then-withdraw patterns, structuring-like behavior just under a
  reporting threshold).
- **Recordkeeping**: the `wallet_ledger` table already gives an immutable audit trail of
  every credit/debit with a `trustly_ref`; confirm retention period requirements with
  counsel (this is likely years, not months).
- **Suspicious Activity Reporting**: `[COUNSEL: confirm whether the platform itself has
  any SAR/FinCEN obligations, or whether this sits entirely with Trustly as the money
  transmitter of record - this depends on the final entity/licensing structure from
  00-READ-ME-FIRST.md item 1.]`

## Tax Reporting

- US federal: `[COUNSEL: confirm 1099-MISC vs 1099-K thresholds and which form applies
  given the platform's role as either "payor of winnings" or a mere payment
  intermediary - this depends on the licensing structure.]` The platform now **tracks
  `lifetime_winnings_cents` per player** (`payout_game`) and **locks withdrawals at $550
  until tax details are confirmed** (`reserve_withdrawal` raises `TAX_DETAILS_REQUIRED`),
  keeping ahead of the $600 1099-MISC threshold. The remaining piece is 🔌 the actual
  W-9 collection + 1099 filing - this was going to be Stripe Tax before Stripe was
  removed from the platform; needs a replacement vendor wired to call
  `confirm_tax_details` on completion.
- A W-9 (or W-8BEN for non-US persons, if allowed at all - see eligibility/geofencing
  question) is gated before withdrawals cross the threshold above.

## Build status of the controls this checklist calls for

Several items below moved from "to build" to **built and DB-enforced** since this
checklist was first written (see `docs/LAUNCH-CHECKLIST.md` for the full status map).
The 🧑/🔌 items still need a human decision or a vendor key, not engineering.

1. ✅ `blocked_states` / `allowed_states` config (admin-editable, not hardcoded),
   enforced in `buy_round` at the real-money action. Defaults to an allowlist.
2. 🧑 Self-service spend limits and self-exclusion in the wallet UI — **not yet built**;
   still the clearest responsible-play gap. Scope as its own workstream.
3. ✅ ID verification gate before first withdrawal (`reserve_withdrawal` → KYC + 18+);
   🔌 Trustly ID wired (`trustly-establish-bank-auth`/`trustly-confirm-bank-auth` →
   `apply_kyc_result`) but **unverified against a real Trustly sandbox** - see the
   "VERIFY" comments in `supabase/functions/trustly-*`.
4. ✅ (partial) Tax-detail gate + lifetime-winnings tracking tied to the payout engine;
   🔌 the W-9 collection + 1099 *filing* still needs a vendor wired (see above - open
   item since Stripe Tax was removed with the rest of Stripe).
5. ✅ Admin view for AML-relevant account flags — the command center's Compliance page
   surfaces anti-cheat flags, KYC review, and account suspend, with every privileged
   action written to `admin_audit_log`.
