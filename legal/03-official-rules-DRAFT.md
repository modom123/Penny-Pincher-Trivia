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
- How that pool is split across finishers is one of the Prize Distribution schemes
  below - see that section rather than assuming a single fixed structure.

### Game 2: Streak Saver
- Entry cost: same per-round pricing as above, but a correct answer makes the *next*
  round free; only an incorrect answer (breaking the streak) charges the round fee.
- `[COUNSEL/OPS: average spend is estimated internally at ~$18.50 per completed game -
  confirm whether average-spend estimates need to be disclosed to players, and whether
  this variable-cost structure changes the AMOE analysis above.]`

### Game 3: Milestone Booster
- Entry cost: flat per-tier pricing (Bronze rounds 1-25 = $0.10, Silver 26-50 = $0.25,
  Gold 51-75 = $0.50, Platinum 76-100 = $1.00).
- Prize pool is funded **solely by player entry fees** (60% pool / 40% platform fee),
  identical to the other two modes. There is **no** platform-funded prize injection.
  `[HISTORY: an earlier design injected a platform-funded "guaranteed bonus" into the pot
  at rounds 25/50/75. That was removed because a platform-funded prize - as opposed to
  one funded purely by entry fees - could raise its own sweepstakes/AMOE classification
  question. This mode is now a pure skill-contest pricing variant.]`

### Prize Distribution (applies to all three modes)

The 60%-of-entry-fees prize pool described above is split across finishers according to
one of four schemes. Platform staff assign one scheme to each game at creation - it is
**not** tied to which of the three Game Modes above is being played, and it is disclosed
to the player, along with the resulting number of paid places, before they enter that
specific game.

- **Standard** (the default): scales with field size - fewer than 15 eligible players
  pays the top 3 (50% / 30% / 20% of the prize pool), 15–39 pays the top 5, and 40+ pays
  roughly the top 10% (a decaying podium plus a flat minimum-cash tail).
- **Classic Top 3**: always pays only the top 3 finishers, 50% / 30% / 20%, regardless of
  how large the field grows.
- **Winner-Take-Most**: pays only the top 3 finishers, weighted 70% / 20% / 10%.
- **Spread the Wealth**: pays roughly the top 25% of the field (minimum 5 places) on a
  gentle decay, so more players win a smaller share.

`[COUNSEL: confirm a single game's payout mechanics may legally vary from one instance of
the contest to the next, provided it is disclosed before entry each time, or whether
prize-structure variability itself needs separate disclosure/registration in some target
states.]`

### Sudden Death Overtime (applies to all three modes)
- Triggered only if two or more players are tied for a top-3 finishing position at
  Round 100.
- Live, shrinking-timer tiebreaker; flat entry fee per question (`[OPS: insert amount,
  e.g., $1.00]`) until the tie is resolved.

### No Eligible Winner (applies to all three modes)
- If every player in a game is eliminated or disqualified before Round 100 and none
  remain eligible for the grand prize, that game's prize pool is **not** forfeited or
  retained by the platform.
- Instead it becomes the starting pool for a new replacement tournament in the same Game
  Mode, at the same pricing and Prize Distribution scheme.
- That replacement tournament opens for sign-ups at the next scheduled **weekly rollover
  slot** (currently Saturday 6:00 PM UTC - `[OPS: confirm final slot before launch;
  configurable via platform_config 'rollover_schedule']`), rather than immediately.
- Affected players are notified in-app when this happens.
- If the replacement tournament also ends with no eligible winner, its pool carries
  forward again to the following week's slot, and so on until a winner is determined.
- Each rollover carries forward a **single game's own pool** into one same-format
  replacement. Pools are never combined across different Game Modes or across multiple
  void games into a shared jackpot - this was a deliberate design choice; pooling
  unclaimed prizes platform-wide into one recurring jackpot would look considerably more
  like a lottery than a skill contest. `[COUNSEL: confirm this rollover mechanism itself
  doesn't raise its own classification question even without cross-mode pooling - an
  escalating, unclaimed pool carrying forward on a fixed weekly schedule has some
  resemblance to a lottery draw even when scoped to one game's own money.]`

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
