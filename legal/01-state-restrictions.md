# Illustrative US state restriction checklist (NOT authoritative)

**[COUNSEL: this entire document must be verified against current statutes before use.**
Laws in this area change frequently, vary by exact contest structure, and this list was
compiled from general knowledge of skill-game/sweepstakes law patterns, not a current
statutory review. Treat every row as "needs verification," not "confirmed."]

The pattern below is common across daily-fantasy-sports and skill-contest platforms,
which face substantially the same legal question Penny Pincher does (pay-to-enter, cash
prize, skill-predominant format). Rough categories:

## Historically restrictive or unresolved for real-money skill contests
`[COUNSEL: confirm current status of each]`

- Arizona
- Arkansas
- Connecticut (registration/licensing regimes)
- Delaware
- Florida (contest registration/bonding required above certain prize thresholds)
- Hawaii
- Idaho
- Illinois
- Iowa
- Louisiana
- Maryland (registration required above certain thresholds)
- Michigan
- Montana
- Nevada (gaming license regimes are broad here)
- New York (registration/bonding regimes; historically contentious for DFS-style products)
- North Dakota
- Rhode Island (registration/bonding required above certain prize thresholds)
- South Carolina
- South Dakota
- Tennessee
- Vermont
- Washington

## Practical launch approach
`[COUNSEL: confirm this is still the right practical approach]`

Most real-money skill-contest platforms launch with a **state allowlist**, not a
blocklist - i.e., default to blocking every US state and territory, then turn states on
one at a time only after counsel confirms legality and any registration/bonding
requirements are satisfied. This repo's Terms of Service draft assumes that approach and
references a `[COUNSEL: insert approved state list]` placeholder rather than asserting
which states are safe.

## Enforcement mechanism this needs (not yet built)

An allowlist in a Terms of Service document does nothing on its own. Before real money
is enabled, the product needs:

1. **IP-based geolocation** at minimum, ideally combined with device GPS on mobile,
   re-checked periodically during play (not just at signup) - this is standard practice
   for DFS/skill-contest apps and is often a regulatory expectation, not just a
   nice-to-have.
2. **Address/ID verification** at withdrawal time at the latest (ties into KYC, see
   `05-responsible-play-and-aml.md`).
3. A `blocked_states` config the admin/command-center can update without an app release,
   since legal status changes over time and per-state rules can change faster than a
   mobile app store review cycle.

None of this exists in the current build. It should be scoped as its own workstream
before this app can legally accept real payments from the general public.
