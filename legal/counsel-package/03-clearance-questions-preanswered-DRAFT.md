# 03 — Clearance Questions, Pre-Answered DRAFT (for counsel's correction)

The twelve questions from §3 of the intake package, each with our researched
draft answer. **These drafts are unverified AI-assisted research** — they exist
to cut counsel's first-pass hours, not to anchor conclusions. Facts referenced
are per `01-product-ground-truth.md` (which corrects the intake PDF).

## 3.1 Entity structure & money transmitter licensing

**Draft answer:** Holding player wallet balances (deposits awaiting play,
winnings awaiting withdrawal) is the classic fact pattern that triggers state
money-transmitter analysis. Common mitigations: (a) structure so the licensed
processor is the money transmitter of record and the operator never takes
possession/control of player funds (for-the-benefit-of accounts); (b) the
"payee agent" exemption where recognized [VERIFY per state]; (c) obtain MTLs
(slow/expensive — likely a raise-triggering path). Because the payment rail is
being re-selected (Stripe restricted the account; Trustly is planned but not
built), we ask counsel to specify the wallet/custody structure the replacement
integration must implement — this is cheaper to build correctly than to
retrofit. FinCEN MSB registration follows the same analysis federally [VERIFY].

## 3.2 State-by-state legality

**Draft answer:** See document 02 (seven-state survey) and its worksheet.

## 3.3 No-purchase-necessary alternate entry

**Draft answer:** AMOE is a *sweepstakes* doctrine — it removes consideration
where prizes are awarded by chance. For a bona fide skill contest,
consideration is generally permitted and AMOE is not required [VERIFY per
state]. The risk is conditional: if any target state treats this format's
chance element as material (question randomness, streak/tiebreaker mechanics),
that state may recharacterize the product as a sweepstakes/lottery, and an
AMOE would not cure an entry-fee prize lottery anyway. So the real question is
the classification one; we ask counsel to confirm no target state requires
free entry for a skill-predominant contest, rather than to design an AMOE.

## 3.4 Prize registration / bonding thresholds

**Draft answer:** The prominent registration/bonding regimes (NY, FL — and AZ
historically [VERIFY]) apply to chance-based prize promotions and are outside
our 7 launch states. Within the seven, we found no skill-contest
registration/bonding requirement [VERIFY carefully — esp. any general prize
promotion statutes in MA/CA]. Fantasy-contest registration regimes in OH, PA,
VA, NJ appear definitionally limited to sports-statistics contests — confirm
trivia is outside each (survey wrinkles, doc 02). If the §3.11 rollover is
built later, re-ask this question: an accumulated rolled pool is likelier to
cross promotional-prize thresholds.

## 3.5 AML / KYC obligations

**Draft answer:** If the operator avoids money-transmitter status (3.1), BSA
program obligations (SAR/CTR) likely rest with the processor/banks; the
operator still needs OFAC screening on payouts and should keep the existing
KYC-before-withdrawal and immutable-ledger controls [VERIFY allocation].
If the operator IS an MSB, it needs a full AML program (written program,
compliance officer, training, independent review, SAR filing). Counsel to
confirm which side of the line the chosen custody structure lands on, and
whether any of the seven states impose their own AML duties on skill-contest
operators.

## 3.6 Tax reporting

**Draft answer:** Platform-paid contest winnings are reportable on **Form
1099-MISC (box 3, other income) at $600+ per year** [VERIFY]; 1099-K is for
payment-card/TPSO transactions and should not apply to prize payouts; W-2G is
for gambling winnings and would be inconsistent with our skill position
[VERIFY]. Our current control locks withdrawals at $550 *lifetime* pending tax
details; counsel should confirm the correct basis is **calendar-year**
winnings (likely) and whether the threshold/mechanism should change. Backup
withholding (24%) applies without a valid TIN — the W-9 collection vendor is
an open item; counsel's recommendation requested (e.g., Tax1099/Track1099-class
e-file vendors, or the replacement processor's tax product).

## 3.7 Age & location verification standard

**Draft answer:** Current build: self-attested 18+ at signup, verified
identity/age only at withdrawal; location self-declared until the Radar key is
installed (then vendor-verified and anti-spoofed, re-checked in-game). We ask
counsel: (a) is deposit-time (rather than withdrawal-time) age/identity
verification required anywhere in the seven; (b) is 18 the right floor
everywhere (MA's DFS regs use 21 [VERIFY] — advise whether 21 in MA is
required or prudent); (c) is vendor-verified geolocation required from the
first real-money transaction (our launch plan enforces it from public launch;
soft launch is invite-only testers).

## 3.8 Payment processor approval

**Draft answer (mostly a business fact for counsel's awareness):** Stripe
restricted the account (this is why the PDF's Trustly narrative exists — see
doc 01 corrections). Before any volume: obtain the replacement processor's
**written** confirmation that this exact product is within its acceptable-use
policy, and have counsel's opinion letter available for underwriting. Counsel:
advise whether a specialty RMG processor with gaming underwriting is preferable
to Trustly for this risk profile, and what the custody structure (3.1) implies
for the choice.

## 3.9 Responsible-play requirements

**Draft answer:** Nothing is built today. Statutorily mandated
responsible-play tooling for *skill contests* appears rare in the seven
[VERIFY]; but MA (940 CMR 34-style expectations), app-store review, and
processor underwriting all effectively require: deposit/spend limits,
self-exclusion/cooling-off, and a problem-gambling resource link (NCPG
1-800-GAMBLER). Draft position: build the minimum set regardless of strict
legal necessity; counsel to specify any state-specific requirements (limits
defaults, disclosure text, 21+ in MA, etc.).

## 3.10 Prize-distribution scheme variability

**Draft answer:** Four schemes, staff-assigned per game, disclosed in-app
before entry (verified in code; shares sum exactly to the pool). Draft
position: pre-entry disclosure of the exact scheme satisfies the general
false-promotion/disclosure statutes [VERIFY, esp. Cal. B&P § 17539 series];
variability across game instances is not itself a classification problem so
long as each game's terms are fixed and disclosed before its own entries are
taken. Counsel to confirm and to specify required disclosure language in the
Official Rules.

## 3.11 No-eligible-winner handling (REVISED FACTS)

**Draft answer:** Current deployed behavior is a **full pro-rata refund** of
the pool to its contributors (doc 01, correction 2) — which should be the
legally conservative outcome (no accumulation, no lottery-resembling jackpot,
players made whole). The *proposed* weekly rollover (pool seeds a same-format
replacement tournament at a fixed weekly slot, cascading if unclaimed, never
combined across game modes) is a design question for counsel BEFORE we build
it: does an accumulating unclaimed pool on a fixed schedule create
lottery-classification or promotional-registration risk (3.4), and if
buildable, what constraints (rollover count cap, dollar cap, forced-payout
terminal round) should apply? If counsel disapproves, we keep the refund.

## 3.12 App store distribution (Google Play / Apple)

**Draft answer:** Sequenced after the opinion letter exists: both stores
manually review real-money skill contests, require documentation of the
state-by-state position, restrict listings to documented jurisdictions, and
permit external payment processing only as part of that approval. Ask: package
the opinion letter + state list + geofencing/KYC/RG description into the
application; realistic timeline weeks-to-months; do not submit before the
classification answers exist (a pulled listing post-deposits is the worst
outcome). Launch is web/PWA until then (already the plan).

---

*Prepared with AI assistance, without attorney involvement, for counsel review
only. Not legal advice; not relied upon for any live operation.*
