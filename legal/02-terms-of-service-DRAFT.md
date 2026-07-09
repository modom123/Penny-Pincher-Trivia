# Penny Pincher Trivia — Terms of Service (FINAL DRAFT for counsel review)

> **This is a review-ready draft, not a published legal instrument, and not legal
> advice.** It states the App's mechanics accurately and drafts the clauses a real-money
> skill-contest ToS needs, but a gaming/gambling attorney licensed in each launch state
> **must** review it before publication. Items that turn on a legal judgment we cannot
> make are marked `[COUNSEL]`. See `legal/00-READ-ME-FIRST.md`.

**Last updated:** `[OPS: insert publication date]`
**Operator:** `[OPS: insert legal entity name, registered address, support email]`

---

## 1. Acceptance of These Terms

By creating an account, adding funds, or entering any contest on Penny Pincher (the
"App," "Service," "we," "us," "our"), you agree to these Terms of Service ("Terms") and to
our Privacy Policy and Official Rules, each incorporated by reference. If you do not
agree, do not use the Service.

## 2. Definitions

- **Contest / Game** — a single 100-round trivia competition with a shared prize pool.
- **Round** — one timed multiple-choice question within a Contest.
- **Token** — the in-App unit of value; **1 Token = US$0.01**. Tokens exist in two
  balances (Section 4).
- **Entry Fee** — the Tokens required to unlock a Round.
- **Prize Pool** — the portion of collected Entry Fees paid to top finishers.
- **Skill Contest** — a competition whose outcome is determined predominantly by the
  participant's knowledge and speed, not by chance.

## 3. Eligibility

3.1. You must be at least **18** years old. `[COUNSEL: confirm 18 vs 21 per launch state;
some states set 21 for cash-prize contests.]`

3.2. You must be a legal resident of, and **physically located in**, a jurisdiction where
real-money skill contests of this type are permitted. The Service uses location
verification and only permits paid entry from **approved states** (an allow-list, not a
block-list). If your location cannot be verified, or you are in a non-approved
jurisdiction, you may not enter paid Contests. `[COUNSEL: provide the approved-state list
from 01-state-restrictions.md, and confirm whether a free no-purchase-necessary Alternative
Method of Entry (Section 16) is required in any target state.]`

3.3. Employees, officers, contractors, and their immediate household members of the
Operator and its affiliates may not participate for real-money prizes.

3.4. **One account per person.** Multiple, duplicate, or shared accounts are prohibited
and may be closed with forfeiture of non-cash balances. `[OPS: enforcement — KYC identity
matching + device signals.]`

3.5. You must not be listed on any government sanctions/prohibited-persons list.

## 4. Tokens, Deposits & the Two-Balance Wallet

4.1. **Token value.** Each Token represents US$0.01 of in-App value. Tokens are used only
to enter Rounds and to receive prize credit; they are not a general-purpose stored-value
instrument. `[COUNSEL: confirm money-transmitter / stored-value characterization and any
required licensing or disclosures.]`

4.2. **Bundles and bonus Tokens.** Tokens are sold in bundles; larger bundles include
promotional bonus Tokens: $1.00 → 100, $5.00 → 600, $10.00 → 1,300, $20.00 → 2,800.

4.3. **Two balances.** Your wallet has two separate balances:
- **Cash Balance** — Tokens funded by your own payment, plus prize winnings. This balance
  is **withdrawable** (Section 6), subject to verification.
- **Promotional Balance** — bonus Tokens and promotional credits. Promotional Tokens
  **can be used to enter Contests but can never be withdrawn for cash.** Entry Fees draw
  from your Promotional Balance first, then your Cash Balance.

This separation is enforced by the Service: withdrawals are paid only from the Cash
Balance. `[COUNSEL: confirm the bonus-Token disclosure meets consumer-protection
requirements in each state; it must be presented clearly at the point of purchase.]`

4.4. **Deposits.** Token purchases are processed by Stripe. We do not store full card
details.

4.5. **No refunds on Tokens.** All Token purchases are final and non-refundable once
completed, except where a refund is required by law. Entry Fees are non-refundable once a
Round is unlocked, win or lose. `[COUNSEL: confirm enforceability in consumer-protection
states; some require a limited cooling-off or refund of unused funds.]`

4.6. **Dormant accounts / unclaimed funds.** `[COUNSEL/OPS: insert dormancy and
unclaimed-property (escheatment) handling — legally required in many states for balances
representing real money.]`

## 5. How Contests Work (Rules & Scoring)

The full mechanics are in the Official Rules (incorporated by reference). In summary:

5.1. **Structure.** A Contest has up to 100 progressively priced Rounds. In the standard
mode, **Round *N* costs *N* Tokens** (Round 1 = 1¢ … Round 100 = $1.00). Other modes
(Streak Saver, Milestone Booster) vary Entry-Fee timing and are described in the Official
Rules. `[COUNSEL: the Milestone Booster mode injects platform-funded prize bonuses; review
whether this affects the contest's classification before enabling it for real money.]`

5.2. **The same questions for everyone.** Every entrant in a given Contest answers the
identical set of Rounds. Outcomes are determined by your **knowledge and answer speed**,
measured against the same questions faced by every competitor.

5.3. **Scoring** (computed only by our servers; the **server clock is authoritative**, not
your device):
- **Correct answer:** points equal to (round number × 10) plus a speed bonus for time
  remaining. Later rounds and faster correct answers are worth more.
- **Incorrect answer:** a points penalty of (round number × 10), with no speed component.
- **Skip / Pass:** you may decline to answer a Round for **zero points and no penalty** —
  you are never required to guess.
- Your total score is floored at zero and can never go negative.
- There is **no advantage for spending more money**; points come only from answering
  correctly.

5.4. **Ranking & tie-breaker.** Players are ranked by total score (highest first). Ties
are broken in favor of the player who **spent the fewest Tokens** to reach that score.

5.5. **Sudden Death Overtime.** If players remain exactly tied (equal score and equal
Tokens spent) for a top-3 position after Round 100, those tied players — and only those
players — enter additional tiebreaker Rounds at a flat Entry Fee under a shortened timer,
until the tie resolves. `[COUNSEL: an accelerating, pay-per-question tiebreaker warrants
specific review for urgency/pressure dynamics independent of the base game's
classification.]`

## 6. Prizes & Withdrawals

6.1. **Prize split.** At the end of a Contest, **60% of the Prize Pool** is paid to the
top eligible finishers and the Operator retains **40%** as a platform fee. The **number of
paid places scales with the size of the field** (for example, top 3 in small Contests,
increasing to top 5 and top 10 as the field grows), under a published payout schedule.
The default small-field split is 50% / 30% / 20% to 1st / 2nd / 3rd. The applicable
schedule for each Contest is shown before entry and set out in the Official Rules.
`[COUNSEL: confirm the payout schedule and any state-mandated prize-disclosure language.]`

6.2. **Prize credit.** Prizes are credited to your Cash Balance.

6.3. **Withdrawals.** You may withdraw from your Cash Balance to a linked payment account
(via Stripe Connect), subject to identity verification (Section 8) and tax compliance
(Section 7). We may delay or decline a withdrawal pending verification, investigation of
suspected violations, or as required by anti-money-laundering law.

6.4. **Void where prohibited.** Contests and prizes are void where prohibited or
restricted by law. `[COUNSEL: confirm whether any target state mandates specific
contest-disclosure or bonding language.]`

## 7. Taxes

7.1. You are solely responsible for any taxes on prizes. We track lifetime winnings and,
as you approach the federal reporting threshold (currently US$600), we will require you to
provide tax information (e.g., a W-9 via our processor) before further withdrawals. We may
issue an IRS Form 1099 where required. `[COUNSEL: confirm calendar-year vs lifetime
treatment and state reporting thresholds.]`

## 8. Identity Verification (KYC) & Anti-Money-Laundering

8.1. Registration and deposits require only a valid email. **Identity verification (legal
name, date of birth confirming 18+/`[COUNSEL]`, and government ID) is required before your
first withdrawal**, and may be required again periodically.

8.2. We may delay, limit, or refuse withdrawals, and suspend accounts, to comply with KYC
and AML obligations. `[COUNSEL: confirm KYC vendor, thresholds, and record-keeping
obligations for your structure.]`

## 9. Fair Play, Anti-Cheat & Integrity

9.1. **Prohibited conduct.** You may not: use bots, scripts, automation, or assistance
tools; collude with other entrants; exploit bugs or errors for gain; access or attempt to
access question content before it is presented; use multiple accounts; or circumvent
location or identity verification.

9.2. **Detection.** The Service analyzes server-side answer timing. Responses faster than a
human-plausible threshold (stricter on high-value late Rounds) are flagged. Repeated flags
within a Contest may **disqualify you from that Contest's Prize Pool**, and we may void
scores, suspend, or terminate accounts for violations of this Section.

9.3. **Investigations & holds.** We may withhold a prize pending investigation of
suspected cheating, collusion, or fraud. `[COUNSEL: confirm any required notice/appeal
process before withholding a prize.]`

## 10. Community Chat & Conduct

10.1. Contests may include a live spectator chat. You are responsible for what you post.

10.2. You may not post content that is unlawful, harassing, hateful, threatening,
sexually explicit, that reveals others' private information, or that facilitates cheating
or collusion. We may remove messages, mute, suspend, or ban participants, and we retain
messages for moderation and safety. `[OPS/COUNSEL: retention period and moderation policy.]`

## 11. Disputes About Gameplay

We maintain a server-side record of the timing of every answer for a limited period, used
to adjudicate gameplay disputes (e.g., "my answer didn't register"). Our server-side
records are the authoritative record of gameplay events.

## 12. Suspension & Termination

We may suspend or terminate your account, with or without notice, for violation of these
Terms or applicable law, or to protect the integrity of the Service. On termination for
cause, `[COUNSEL: specify treatment of Cash Balance vs Promotional Balance and any
pending prizes — cash-funded balances generally must be returnable absent proven fraud.]`
You may close your account at any time; withdrawable Cash Balance remains subject to
Sections 6–8.

## 13. Responsible Play

We support responsible play, including deposit limits and self-exclusion. `[OPS: implement
and describe deposit/time limits, self-exclusion, and cool-off tools; several states
require these for real-money contests. See 05-responsible-play-and-aml.md.]`

## 14. Intellectual Property

The App, its content, questions, trademarks, and software are owned by the Operator or its
licensors. We grant you a limited, revocable, non-transferable license to use the App for
personal, non-commercial play. You may not copy, scrape, or redistribute question content.

## 15. Disclaimers; Limitation of Liability; Indemnification

15.1. The Service is provided "as is" and "as available" without warranties of any kind to
the maximum extent permitted by law.

15.2. To the maximum extent permitted by law, the Operator is not liable for indirect,
incidental, special, consequential, or punitive damages, and our aggregate liability is
limited to `[COUNSEL: insert cap — commonly the greater of amounts you paid in the prior
N months or a fixed sum.]`

15.3. You agree to indemnify the Operator against claims arising from your breach of these
Terms or misuse of the Service. `[COUNSEL: finalize scope.]`

## 16. No-Purchase-Necessary / Alternative Method of Entry

`[COUNSEL: several states require a free Alternative Method of Entry (AMOE) for cash-prize
contests to avoid lottery classification. Determine whether an AMOE is required in any
target state and, if so, insert the mechanics here; the product must then support a
no-purchase entry path.]`

## 17. Governing Law & Dispute Resolution

`[COUNSEL: insert governing law, venue, arbitration agreement, and class-action waiver
appropriate to your entity and target states — some states restrict mandatory consumer
arbitration; do not adopt boilerplate without state-specific review.]`

## 18. Changes to These Terms

We may update these Terms. For material changes affecting fees, payouts, or your rights,
we will provide notice `[OPS: in-app notice + at least N days before changes take effect.]`
Continued use after changes take effect constitutes acceptance.

## 19. Miscellaneous

Severability; no waiver; entire agreement (these Terms + Privacy Policy + Official Rules);
assignment by the Operator permitted, by you not without consent; force majeure. `[COUNSEL:
finalize standard boilerplate.]`

## 20. Contact

`[OPS: legal entity name, mailing address, and support/legal contact email.]`
