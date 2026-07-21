# Penny Pincher Trivia - Official Rules & Prize Disclosure (DRAFT - not for publication)

`[COUNSEL: many states require a contest's official rules/odds/prize disclosure to exist
as a document independent of the general Terms of Service, sometimes with mandated
content. This draft assumes that structure - confirm it's required/sufficient for your
target states.]`

## No Purchase Necessary clause

`[COUNSEL: THIS IS THE SINGLE MOST IMPORTANT OPEN QUESTION IN THIS ENTIRE PACKAGE.]`
The current product design has **no free/no-purchase method of entry** - every round
requires spending Tokens purchased with real money. Many US sweepstakes/contest
statutes require a free Alternative Method of Entry (AMOE) with equal odds of winning, to
avoid the contest being classified as an illegal lottery. Whether Penny Pincher needs an
AMOE depends on whether it is legally classified as a "contest" (skill-predominant, AMOE
often not required) or a "sweepstakes"/"lottery" (chance-involved, AMOE typically
required) in each target state - and that classification is exactly the open legal
question described in `00-READ-ME-FIRST.md`. **Do not finalize this document, or the
monetization model, without a definitive answer to this question per target state.**

## Game Modes & Prize Structure

### Game 1: Flat-Rate Escalator
- Entry cost: Round *N* costs $0.01 x *N* (Round 1 = $0.01 ... Round 100 = $1.00).
- Maximum possible spend per player per game: $50.50.
- Prize pool: 60% of aggregate entry fees collected in the game; 40% retained as
  platform fee. `[COUNSEL: confirm these percentages don't themselves trigger a
  different regulatory classification in any target state - some jurisdictions cap the
  "house" percentage retained in a skill contest.]`
- Prize distribution scales with the field size: fewer than 15 eligible players pays the
  top 3 (50% / 30% / 20% of the prize pool), 15–39 pays the top 5, and 40+ pays roughly
  the top 10% (a decaying podium plus a flat minimum-cash tail). The applicable schedule
  and number of paid places is shown before entry.

### Game 2: Streak Saver
- Entry cost: same per-round pricing as above, but a correct answer makes the *next*
  round free; only an incorrect answer (breaking the streak) charges the round fee.
- `[COUNSEL/OPS: average spend is estimated internally at ~$18.50 per completed game -
  confirm whether average-spend estimates need to be disclosed to players, and whether
  this variable-cost structure changes the AMOE analysis above.]`

### Game 3: Milestone Booster
- Entry cost: same per-round pricing as Game 1 (Round *N* costs $0.01 × *N*).
- Every 10th round (10, 20, ... 100) is a **bonus question**: a correct answer credits
  that round's cost back to the player's balance as non-withdrawable bonus tokens; an
  incorrect answer claws the same amount back out of the player's *existing* bonus-token
  balance only - never withdrawable cash, and never more than the player currently holds
  in bonus tokens.
- Prize pool is funded **solely by player entry fees** (60% pool / 40% platform fee),
  identical to the other two modes. The bonus-round credit/clawback never adds to or
  draws from the prize pool - there is **no** platform-funded prize injection.
  `[HISTORY: an earlier design injected a platform-funded "guaranteed bonus" into the pot
  at rounds 25/50/75. That was removed because a platform-funded prize - as opposed to
  one funded purely by entry fees - could raise its own sweepstakes/AMOE classification
  question. The bonus-round mechanic added here is deliberately structured the same way
  as the "3 the Hard Way" streak bonus below: player-funded bonus-token movement only,
  never platform-funded cash, to stay on the same side of that line.]`

### Sudden Death Overtime (applies to all three modes)
- Triggered only if two or more players are tied for a top-3 finishing position at
  Round 100.
- Live, shrinking-timer tiebreaker; flat entry fee per question (`[OPS: insert amount,
  e.g., $1.00]`) until the tie is resolved.

### Streak Bonus ("3 the Hard Way", applies to all three modes)
- After three consecutive correct answers, and for every correct answer while that
  streak continues, the round's cost is credited back to the player's balance as
  non-withdrawable bonus tokens. One incorrect answer resets the streak to zero.
- This affects only how far a player's funds carry them within a single game - it does
  not add to, or draw from, the prize pool, and has no effect on withdrawable cash or
  payouts.

## Odds Disclosure

`[COUNSEL/OPS: odds of winning depend on number of entrants and relative skill
distribution and cannot be pre-computed the way a raffle's odds can - confirm what
disclosure standard applies to a skill contest with variable entrant counts, since the
"state your odds" requirement common in sweepstakes law is usually written with
chance-based games in mind.]`

## Eligibility, Void Where Prohibited

See Terms of Service Section 2. This contest is void in jurisdictions listed in
`01-state-restrictions.md` and wherever otherwise prohibited by law.

## Dispute of Results

`[OPS: define the process - e.g., "disputes must be submitted within 48 hours of game
completion via [support channel]; decisions by [designated role] are final." Confirm
with counsel whether any state mandates a specific dispute window or process for
contests above a certain prize value.]`

## Sponsor / Administrator

`[OPS: insert legal entity name and address once formed - most jurisdictions require
this to be disclosed for any contest with a prize.]`
