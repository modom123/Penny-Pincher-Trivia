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

## Enforcement mechanism this needs (now built — see LAUNCH-CHECKLIST.md §3)

An allowlist in a Terms of Service document does nothing on its own. The three controls
below are now **built and enforced at the database layer** (`buy_round` in
`supabase/migrations/`), so a client cannot bypass them. What remains is a vendor key and
counsel's per-state answers, not engineering:

1. **Device/IP geolocation, re-checked during play** — ✅ built. The `geo-check` edge fn
   records a verified region (`set_verified_region`); the mobile client calls it on
   `RegionGate` and on `GameScreen` mount, not just at signup. Anti-spoof is enforced via
   Radar's signed verified-location JWT when `RADAR_JWT_SECRET` is set (🔌 supply the key
   + install `react-native-radar` on device builds).
2. **Address/ID verification at withdrawal** — ✅ built. `reserve_withdrawal` blocks any
   payout until `kyc_status = 'verified'` and the player is 18+ (ties into KYC, see
   `05-responsible-play-and-aml.md`).
3. **Admin-editable `allowed_states` / `blocked_states` config** — ✅ built. Both lists
   live in `platform_config` and are editable from the command center's Compliance page
   (`admin_update_allowed_states` / `admin_update_blocked_states`) with no app release.
   The build defaults to an **allowlist** (default-block every region), seeded to the
   launch set TX, CA, NY, OH, PA.

The engineering enforcement exists. What still gates real payments from the general
public is **counsel's answer on which states to turn on** (the allowlist above is an
engineering default, not a legal clearance) and the vendor keys noted above.
