# Penny Pincher — Skill vs. Chance (design memo)

> **Not legal advice.** This maps how the *product is built* to the tests courts use to
> separate a **game of skill** from **gambling**. Whether the model is lawful is a
> state-by-state, fact-specific legal question — get gaming/gambling counsel to review
> before real money and real users. See `legal/00-READ-ME-FIRST.md`.

## Why this matters here

Gambling = **consideration + prize + chance**. Penny Pincher unambiguously has the first
two (token entry fees; a cash payout to the top 3). So the *entire* legal defense rests
on **chance not determining the outcome** — the skill characterization does all the work.
This memo documents the design choices that keep outcomes skill-determined, and the
engineering controls that back them up.

## The tests

- **Dominant-factor / predominance test** (most US states): is the outcome determined
  *predominantly* by skill rather than chance?
- **Material-element test** (e.g. NY): does chance play a *material* role, even if skill
  predominates?
- **Any-chance test** (a strict minority): does *any* material chance element exist?

The design below is aimed at the strictest reading we reasonably can, which is why the
build ships **geo-fencing** (`platform_config.blocked_states`, enforced in `buy_round`)
to exclude jurisdictions where counsel says the risk is unacceptable.

## What determines the outcome (from the code)

| Element | How it works | Skill / chance |
|---|---|---|
| **Points** | `submit_answer`: correct → `round×10 + ms-remaining`; wrong → `−(round×10)`; skip → `0`. Server clock is authoritative. | Skill (knowledge + recall speed) |
| **Same questions for all** | `game_rounds` is keyed by `(game_id, round_number)` — every player in a contest faces the identical 100 questions. | No chance *between* competitors |
| **Winner** | Top-3 by `total_score`, tie broken by **least cash spent** (`payout_game`). No random component. | Skill + frugality |
| **Ties / overtime** | Sudden Death Overtime = more trivia among the tied players. | Skill |
| **Difficulty** | 20 grade levels (3rd grade → grade 22); 5 rounds per level. | Skill (measured, see below) |

There is **no** random multiplier, loot, wheel-spin, or chance-based bonus anywhere in
scoring or payout.

## Design choices that push toward skill

1. **Guessing has negative expected value.** A 4-option question gives a blind guesser
   25%, but the **wrong-answer penalty** (`−round×10`) makes random guessing a losing
   strategy. A knowledgeable player is rewarded; a guesser is punished.
2. **A skip / pass option** (`submit_answer` accepts `SKIP` → 0 points, no penalty) so a
   player who doesn't know an answer is **never forced into a coin-flip**. Removing forced
   guesses removes forced chance.
3. **Correct-answer position is randomized** (`shuffleOptions` in the curator) so there's
   no positional pattern (LLM "always C" bias) a guesser could exploit.
4. **Large sample.** 100 independent questions per contest means variance washes out and
   skill dominates by the law of large numbers — a core predominance argument.
5. **Identical, shared question set** per contest (already enforced by schema). The only
   randomness is *which* curated questions are drawn, and that draw is **common to all
   competitors**, so it doesn't advantage anyone.
6. **Empirically calibrated difficulty.** `question_item_analytics()` reports per-question
   correct-rate and a **discrimination** score (avg score of players who got it right
   minus those who got it wrong). Low/negative discrimination flags a question that
   *isn't* measuring skill (ambiguous/miscalibrated) so it can be re-tiered or removed —
   turning the contest into a *measured* skill test, not a trivia lottery.
7. **Integrity controls.** Server-authoritative timing, `cheat_flags` for bot-speed
   answers, and the `websocket_logs` black-box ledger ensure the *skilled human* wins, not
   an exploit — and give an auditable record if a result is disputed.

## Still open (recommended, not yet built)

- **Void-and-rescore** for a question later found wrong/ambiguous, so a defective question
  doesn't inject noise into standings.
- **Auditable/curated draw** (fixed disclosed set or commit-reveal seed per contest)
  instead of opaque `order by random()`, to close the last chance-shaped element.
- **Free practice mode** — demonstrates the game is *learnable* (a skill hallmark) and
  helps consumer-protection posture.
- **Published Official Rules** stating: identical questions for all entrants,
  skill-determined scoring, the 100-question sample, and the penalty/skip mechanics.

## Bottom line

As built, outcomes are determined by **what a player knows and how fast they recall it**,
over a large, shared, identical question set, with guessing made unprofitable and forced
guesses eliminated. That is a strong skill-predominant design. The residual legal risk is
not that the *game* is chance-based — it's that it's a *real-money contest*, so the skill
characterization must hold up jurisdiction by jurisdiction. Counsel decides that; the
geo-fence is the safety valve.
