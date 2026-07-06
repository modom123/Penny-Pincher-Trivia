# Read this before anything in /legal goes near a real user or real money

**None of the documents in this folder are legal advice, and I am not a lawyer.** They
are a compliance *framework* - a structured starting point for you to take to a
gaming/gambling attorney licensed in the state(s) you intend to launch in. Do not publish
the Terms of Service, Official Rules, or Privacy Policy drafts as-is. Do not process a
real payment or a real payout until counsel has signed off.

## Why this app needs that review, specifically

Penny Pincher is a **real-money, pooled-entry-fee contest with a cash prize** paid to the
top finishers. That is the same basic shape as:

- Daily fantasy sports (DFS) platforms, which operate legally in most - but not all -
  US states, under "game of skill" carve-outs, and are explicitly **banned or heavily
  restricted** in others (see `01-state-restrictions.md`).
- Skillz-network head-to-head wagering apps, which the competitive-analysis doc you
  provided cites directly as a comparable.

"It's skill-based, not gambling" is the theory the product design leans on (server-side
timers, no chance mechanic in the base question-answer loop), but **that theory does not
self-execute** - several states classify *any* pay-to-enter contest with a cash prize as
illegal gambling or a lottery regardless of the skill/chance mix, unless specific
conditions are met (e.g., a free/no-purchase-necessary alternative method of entry,
registration/bonding above certain prize thresholds, or an outright ban on cash-prize
skill contests). The "Sudden Death Overtime" tie-breaker and the "Milestone Booster"
game's chance-flavored "bonus injections" both push further toward regulatory scrutiny
than a pure quiz would, and should get specific legal sign-off before being built.

## What still needs a licensed attorney's answer before launch

1. **Entity structure & licensing**: does operating this require a money transmitter
   license (state-by-state) for holding player funds between deposit and payout/withdrawal?
   Stripe Connect changes this analysis but doesn't eliminate it.
2. **State-by-state legality** of pay-to-enter, cash-prize skill contests - not just
   "gambling law" but also specific skill-game/sweepstakes statutes (several states have
   both).
3. **Whether a "no purchase necessary" / free alternative entry method is required.**
   Right now the app has no free entry path - every round costs tokens. That is a real
   legal exposure area, not a style choice.
4. **Prize-value registration/bonding thresholds** - several states (e.g., historically
   NY, FL, RI) require registering a contest or posting a bond once the prize pool
   crosses a dollar threshold.
5. **AML/KYC obligations** on withdrawal (Stripe Connect requires this at the payments
   layer; you may have additional obligations at the platform layer once payouts get
   large or frequent).
6. **Tax reporting** - IRS Form 1099-MISC/1099-K obligations once a player's winnings
   cross reporting thresholds; state equivalents vary.
7. **Age verification & geofencing** - "18+" self-attestation in a Terms of Service is
   not the same as an enforced age/location gate, and regulators generally expect
   the latter for real-money contests.
8. **Payment processor approval.** Stripe's Restricted Businesses policy lists
   "gambling" and in some cases skill-based cash contests as requiring pre-approval or
   being outright prohibited depending on jurisdiction and structure - this needs
   explicit confirmation from Stripe (or a specialty gaming payments processor) before
   you build further on the assumption that plain Stripe Checkout/Connect will work at
   scale. Being quietly shut off from payments after launch is a common failure mode for
   apps in this category.

## What's in this folder

| File | Purpose |
|---|---|
| `01-state-restrictions.md` | Illustrative (not authoritative) list of higher-risk US states for pay-to-enter skill contests - a starting checklist for counsel, not a launch map. |
| `02-terms-of-service-DRAFT.md` | Draft ToS covering eligibility, the token/wallet system, scoring, payouts, and disputes. |
| `03-official-rules-DRAFT.md` | Contest/prize disclosure document (odds, prize structure, void-where-prohibited) - many states require this to exist independent of the ToS. |
| `04-privacy-policy-DRAFT.md` | Draft privacy policy covering account, payment, and gameplay telemetry data. |
| `05-responsible-play-and-aml.md` | Responsible-play messaging requirements and an AML/KYC/tax-reporting checklist for the payout flow. |

Every draft below has a `[COUNSEL: ...]` marker anywhere a placeholder, a jurisdiction-
specific number, or a genuinely open legal question sits - grep for `COUNSEL` before
sending anything out for review so nothing gets missed.
