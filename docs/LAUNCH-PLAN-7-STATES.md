# Penny Pincher — 7-State Phased Launch Plan

Five phases: clear and launch **seven states first**, prove the model on its own
revenue, then expand state coverage and app-store distribution in waves. This is the
operating plan referenced by the seeded `allowed_states` default (migration
`20260723000000_seven_state_launch_allowlist.sql`).

> **Legal status disclaimer.** The 7-state set below is an *engineering/business
> default*, chosen from the same DFS/skill-contest patterns described in
> `legal/01-state-restrictions.md`. **No state on this list is cleared until
> gaming/gambling counsel confirms it in writing** (Phase 1 exit gate). Counsel may
> remove or swap states; the allowlist is admin-editable from the Command Center with
> no app release, so plan changes are a config edit, not a code change.

---

## The 7 launch states

| State | Why it's in the launch set |
|---|---|
| **California (CA)** | Largest market; long-standing home of skill-contest operators; no dedicated skill-contest prohibition pattern |
| **Texas (TX)** | Second-largest market; commonly included by skill-gaming platforms |
| **Ohio (OH)** | Large market; commonly included; already in the prior engineering default |
| **Pennsylvania (PA)** | Large market; commonly included; already in the prior engineering default |
| **Massachusetts (MA)** | Commonly included; favorable skill-contest history |
| **New Jersey (NJ)** | Mature real-money-gaming market with clear regulatory lines; commonly included for skill contests |
| **Virginia (VA)** | Commonly included; DFS-friendly statutory posture |

Combined population ≈ 120M (~35% of the US) — enough liquidity to fill 100-round
games without national coverage.

**Deliberately excluded from wave 1:** **New York** (previously in the engineering
default) is deferred — it has registration/bonding regimes and a contentious history
with DFS-style products (`legal/01-state-restrictions.md`). It moves to a later wave
as a counsel-led, registration-first entry, not a config flip. All 22
higher-risk states in `legal/01-state-restrictions.md` remain blocked by default
(allowlist-primary: anything not listed is blocked).

---

## Phase 1 — Legal clearance & pre-flight (target: weeks 0–6)

Goal: convert the 7-state hypothesis into a written legal position, and close the
engineering gaps that exist regardless of state count.

**Legal (the budget item, ~$10k–$25k):**
- [ ] Engage a gaming/gambling firm; scope = the intake package (`legal/` +
      clearance PDF) limited to the 7 states above.
- [ ] Written skill-vs-gambling determination for this exact structure (escalating
      per-round entry, sudden-death tiebreaker, streak bonus, weekly no-winner
      rollover, four payout schemes).
- [ ] Per-state answer for each of the 7 (including: no-purchase-entry requirement,
      responsible-play requirements, registration/bonding thresholds).
- [ ] Counsel-revised Terms of Service, Official Rules, Privacy Policy
      (`legal/02–04` drafts have inline `[COUNSEL:]` markers ready).
- [ ] Written processor confirmation from Trustly for this business model (lesson
      learned from the Stripe restriction).

**Engineering / vendor keys (tracked in `docs/LAUNCH-CHECKLIST.md`):**
- [ ] Radar anti-spoof geolocation live (`RADAR_JWT_SECRET` set + SDK on device
      builds) — self-declared location ends here.
- [ ] KYC vendor webhook keyed (`KYC_WEBHOOK_SECRET`).
- [ ] Tax vendor selected + wired to `confirm_tax_details` (replaces Stripe Tax).
- [ ] Responsible-play minimums per counsel: deposit/spend limits, self-exclusion,
      problem-gambling resource link (not yet built — see
      `legal/05-responsible-play-and-aml.md`).

**Exit gate (go/no-go):** written counsel clearance in hand for at least 5 of the 7
states, revised legal docs approved, Radar enforced. States that fail review are
removed from `allowed_states` before any real-money play.

## Phase 2 — Controlled soft launch, 2 states (target: weeks 6–10)

Goal: prove money-in/money-out end to end with real players and small stakes.

- Narrow the allowlist to **TX + CA** via Command Center → Compliance (the
  seeded 7-state default is the Phase-3 set; soft launch is a subset).
- Invite-only cohort (target 200–500 players), web/PWA only — **no app-store
  submission yet** (Google/Apple require the Phase-1 documentation anyway).
- Conservative caps: low per-game `max_buy_in_tokens`, small scheduled games,
  deposit ceiling per player if counsel recommends one.
- Validate live: Trustly deposits + withdrawals (integration is engineering-complete
  but unverified against production), KYC gate at cash-out, $550 tax lock, dispute
  desk, geofence rejections from non-launch states.

**Exit gate:** ≥ 20 games completed cleanly; ≥ 10 real withdrawals paid; zero
unresolved compliance incidents; support/dispute load sustainable.

## Phase 3 — Full 7-state public launch (target: weeks 10–16)

Goal: open registration in all counsel-cleared launch states; start paying for the
rest of the plan out of the 40% rake.

- Widen `allowed_states` to the full cleared set (CA, TX, OH, PA, MA, NJ, VA minus
  any counsel removed).
- Public marketing on; responsible-play tools live in-product.
- Tax vendor must be live before the first cohort of winners approaches the $550
  withholding lock at scale.
- Weekly compliance review: geofence rejection logs, KYC failure rates, rollover
  pool sizes (§3.11 of the clearance package — watch for counsel's cap).

**Exit gate:** stable revenue baseline (rake covers infra + support + a legal
reserve), no processor or regulator flags for 60+ days.

## Phase 4 — Expansion wave 2 + app-store applications (target: months 4–7)

Goal: roughly double the footprint and start app-store review, funded by Phase-3
revenue.

- Counsel batch #2 (~$15k–$30k): 8–13 states drawn from the lower-risk remainder
  (candidates: CO, GA, IN, KS, KY, MN, MO, NC, NH, NM, OK, OR, WI — final list is
  counsel's call). Enable per state as written clearance lands — config edit only.
- Submit **Google Play real-money gaming application** using the Phase-1/Phase-4
  legal package; listing restricted to documented states; external payments
  (Trustly) only as part of that approval — never unilaterally. Apple after Google.
- Revisit registration-regime states individually (NY, FL, MD, RI, CT) — enter only
  where registration/bonding cost is justified by market size, with NY first.

**Exit gate:** 15–20 states live; Play application submitted (approval timelines run
weeks–months; do not block state expansion on it).

## Phase 5 — App-store distribution & scale (target: months 7–12)

Goal: mainstream distribution and the long-tail footprint.

- Google Play listing live in documented states; Apple App Store submission.
- Full 50-state survey (now affordable from revenue) → enable the remaining
  defensible states; leave hard-no states (e.g. WA, and others per counsel)
  permanently blocked.
- Scale compliance: periodic counsel re-review (laws shift), annual doc refresh,
  processor volume confirmation with Trustly, evaluate a specialty RMG payments
  processor as backup (the Stripe lesson: always have a second rail identified).
- Decision point: bootstrap onward vs. raise — if counsel requires money-transmitter
  or state gaming licenses for further expansion, that's the trigger to consider
  outside capital (see clearance package §3.1).

---

## Standing rules (all phases)

1. **A state is enabled only after written counsel clearance.** The allowlist
   default in the repo is a plan, not a permission.
2. **Allowlist-primary forever:** every state/territory not explicitly enabled is
   blocked (`buy_round` enforces this in Postgres; clients cannot bypass it).
3. **No app-store submission before the corresponding legal documentation exists**
   (clearance package §3.12 — a pulled listing after players deposit is a worse
   outcome than a late listing).
4. **Each phase pays for the next:** Phase-1 legal is the only pre-revenue spend;
   Phases 4–5 are funded from the rake or don't happen yet.
