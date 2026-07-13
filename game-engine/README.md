# Penny Pincher Game Engine

The one component that **can't** be serverless. Edge Functions can't hold a timer
that spans the tens of minutes a 100-round game takes, so this persistent worker
owns the game clock: it steps each game through its rounds, calls the
`start_round` / `end_round` / `payout_game` Postgres functions (which own all
timing, scoring, and money truth), and broadcasts their results to players over a
Supabase Realtime channel named `game:<gameId>`.

The mobile app (`mobile/src/screens/GameScreen.tsx`) subscribes to that channel
and reacts to these broadcast events:

| Event | When | Payload |
| --- | --- | --- |
| `round:start` | a round opens | `RoundStartPayload` |
| `round:end` | a round closes | `RoundEndPayload` (correct option + live leaderboard) |
| `game:sudden_death` | a tie in a paid place | tied ranks + participants |
| `game:completed` | prizes distributed | `GameCompletedPayload` |
| `game:error` | the driver hit a fatal error | `{ error }` |

## Running

```bash
cd game-engine
npm install
cp .env.example .env   # fill in SUPABASE_URL + service-role key
npm start              # === node index.js --watch (Game Director mode)
```

Two modes:

- **`node index.js --watch`** (default) — "Game Director." Polls for runnable
  games and drives every one it can claim. This is what you run in production.
- **`node index.js <gameId> [<gameId> ...]`** — drive specific games and exit.
  Useful for one-off replays/backfills; still claims a lease, so it won't fight a
  running Director.

## Reliability model (leases)

Each game carries a soft, time-boxed lease (`games.engine_lease_owner` /
`engine_lease_expires_at`, added in the `..._game_engine_lease_and_resume`
migration). It makes the worker safe to crash, redeploy, and even run in more
than one copy:

- **Single driver.** `claim_game_for_engine` is an atomic conditional update, so
  exactly one worker can own a game at a time — no duplicate broadcasts or double
  round-advances if two workers race for the same game.
- **Heartbeat.** While driving, the worker extends its lease every
  `ENGINE_LEASE_SECONDS / 2`. If a heartbeat reports the lease was lost (another
  worker reclaimed an apparently-stalled game), the driver stops immediately
  instead of double-broadcasting.
- **Crash recovery.** `engine_runnable_games` returns both `pending` games and
  `active` games whose lease has lapsed. A worker that died mid-tournament leaves
  its lease to expire (after `ENGINE_LEASE_SECONDS`); the next poll reclaims the
  game and `engine_game_state` resumes it from `current_round` — re-opening an
  interrupted round or stepping past an already-scored one, rather than replaying
  from round 1.

Run multiple instances for high availability: they share the work (each game goes
to whichever worker claims it first) and cover for each other on failure.

## Configuration

All via environment variables (see `.env.example`):

| Var | Default | Meaning |
| --- | --- | --- |
| `SUPABASE_URL` | — | Supabase project URL (required) |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Service-role key; the engine functions are service-role only (required) |
| `NEXT_ROUND_DELAY_MS` | `4000` | Pause between a round ending and the next starting |
| `LATE_ANSWER_GRACE_MS` | `500` | Extra time after a round's limit before answers stop (mirror the DB grace) |
| `ENGINE_LEASE_SECONDS` | `30` | Lease length; a dead worker's games are reclaimable after this |
| `ENGINE_WORKER_ID` | `host:pid:rand` | Override the worker identity (e.g. a stable pod name) |
| `WATCH_POLL_MS` | `15000` | How often Game Director mode polls for runnable games |
| `PURGE_INTERVAL_MS` | `3600000` | How often to purge black-box logs older than 48h |

## Notes

- The service-role key is a full-access credential — keep `.env` out of version
  control (it is `.gitignore`d) and inject the key from your platform's secret
  store in production.
- Round timing is real wall-clock on the server; the client clock is never
  trusted for scoring or cutoffs.
