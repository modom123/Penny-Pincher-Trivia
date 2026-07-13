# Deploying the game-engine on Render

The game-engine drives every live game's 100-round timer + Sudden Death Overtime
and broadcasts round state over Supabase Realtime. It's a persistent worker (no
HTTP port), so it runs on Render as a **Background Worker**, not on Vercel.

## Deploy (Blueprint — one click)

1. Render Dashboard → **New → Blueprint**.
2. Connect this repo. Render reads `render.yaml` and proposes the
   `penny-pincher-game-engine` worker (root dir `game-engine`, `node index.js
   --watch`).
3. It will prompt for the one secret it can't read from the file:
   - **`SUPABASE_SERVICE_ROLE_KEY`** → paste your Supabase **service_role / secret**
     key (Supabase → Project Settings → API → `service_role`, the `sb_secret_...`
     one). This bypasses RLS, so it's a real secret — only ever lives here, never
     in the client apps or the repo.
4. **Apply** → Render builds and starts the worker.

## Plan / cost
Use the **Starter** plan (~$7/mo). **Do not use a free plan** — free instances
sleep on inactivity, and a sleeping worker would freeze a live game mid-round.
The worker must stay always-on.

## Verifying it's running
- **Render → the worker → Logs**: you should see
  `[watch] polling for pending games every 15000ms`. When a game is created it
  logs `[watch] starting pending game …`, then per-round `round N started/ended`.
- **Command Center → Games**: create/publish a game (it starts as `pending`).
  Within ~15s the engine flips it to `active` and you'll see `current_round`
  climb 1 → 100 and the prize pool update. That advancing round counter IS your
  proof the engine is alive.
- If a game sits at `pending` and never advances, the engine is down — check
  Render logs / that the service_role key is set.

## Restarts
Render keeps the worker running and restarts it if the process exits. On restart
`--watch` re-scans for `pending` games and resumes; in-progress games continue
from the DB state (all timing/scoring truth lives in Postgres, not the worker).

## Env vars (already in render.yaml, tune if needed)
| Var | Default | Meaning |
|---|---|---|
| `NEXT_ROUND_DELAY_MS` | 4000 | pause between rounds |
| `LATE_ANSWER_GRACE_MS` | 500 | grace after a round's time limit |
| `WATCH_POLL_MS` | 15000 | how often to poll for pending games |
| `PURGE_INTERVAL_MS` | 3600000 | how often to purge the 48h black-box log |
