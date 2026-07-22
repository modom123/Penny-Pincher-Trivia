# Penny Pincher Trivia - Privacy Policy (DRAFT - not for publication)

`[COUNSEL: review against CCPA/CPRA (California), VCDPA (Virginia), and other state
privacy statutes applicable to your user base, plus COPPA if any users could plausibly
be minors despite the age-eligibility gate. This draft is structural, not a finished
instrument.]`

## Data We Collect

- **Account data**: email, username, password (hashed via Supabase Auth), and, once
  identity verification is required for withdrawal, your legal name, date of birth, and
  address as verified through your linked bank account (processed by Trustly, our
  payments and identity provider - `[OPS: confirm we do not store raw bank credentials
  ourselves; confirm data retention period with Trustly]`).
- **Payment data**: processed by Trustly via direct bank transfer; we store a Trustly
  transaction/authorization reference, not your bank login credentials or account
  number.
- **Gameplay data**: answers, response timing (down to the millisecond, for scoring and
  anti-cheat purposes), scores, and wallet ledger entries.
- **Device/location data**: `[OPS: once geolocation/geofencing is built per
  01-state-restrictions.md, disclose IP-based and/or GPS location collection here,
  including retention period and purpose limitation to eligibility enforcement.]`
- **Support communications.**

## How We Use It

- To operate the game (score answers, run the payout engine, enforce anti-cheat).
- To verify eligibility (age, jurisdiction, one-account-per-person).
- To comply with anti-money-laundering and tax-reporting obligations on payouts.
- To communicate with you about your account, purchases, and payouts.
- `[COUNSEL/OPS: add marketing-use clause and opt-out mechanism if applicable.]`

## Data Sharing

- **Trustly** (payments, identity verification, payouts) - `[OPS: link Trustly's own
  privacy policy as a sub-processor disclosure.]`
- **Supabase** (database, authentication, hosting) - `[OPS: link Supabase's privacy
  policy/DPA as a sub-processor disclosure.]`
- We do not sell personal data. `[COUNSEL: confirm this statement is accurate once all
  vendors/analytics tools are finalized - it is a specific legal claim under some state
  laws (e.g., CCPA's "Do Not Sell" framework), not just a preference.]`

## Data Retention

`[COUNSEL/OPS: define retention periods per data category - gameplay/ledger data likely
needs long retention for dispute/audit/tax purposes; ID verification data retention
should follow your KYC provider's and applicable law's minimums, not be indefinite.]`

## Your Rights

`[COUNSEL: insert applicable rights language per jurisdiction - access, deletion,
correction, portability, opt-out of sale/sharing - and the mechanism to exercise them.]`

## Children's Privacy

This service is not directed to, and not available to, anyone under
`[COUNSEL: confirm age from ToS Section 2]`. We do not knowingly collect data from
minors.

## Contact

`[OPS: insert legal entity name, address, and privacy contact email once formed.]`
