require('dotenv').config();
const os = require('os');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NEXT_ROUND_DELAY_MS = parseInt(process.env.NEXT_ROUND_DELAY_MS || '4000', 10);
const LATE_ANSWER_GRACE_MS = parseInt(process.env.LATE_ANSWER_GRACE_MS || '500', 10);
// Lease length. A game the worker owns is re-heartbeated every LEASE_SECONDS/2;
// if this worker dies, the lease lapses after LEASE_SECONDS and another worker
// (or the same one after a restart) reclaims and resumes the game.
const LEASE_SECONDS = parseInt(process.env.ENGINE_LEASE_SECONDS || '30', 10);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

// Stable-enough identity for this process so lease ownership is attributable and
// a restarted worker never collides with its former self.
const WORKER_ID =
  process.env.ENGINE_WORKER_ID || `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function subscribeChannel(gameId) {
  const channel = supabase.channel(`game:${gameId}`);
  await new Promise((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        reject(new Error(`Realtime subscribe failed for game ${gameId}: ${status}`));
      }
    });
  });
  return channel;
}

// --- Lease helpers -------------------------------------------------------------

async function claimGame(gameId) {
  const { data, error } = await supabase.rpc('claim_game_for_engine', {
    p_game_id: gameId,
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw new Error(`claim_game_for_engine failed: ${error.message}`);
  return data === true;
}

async function releaseGame(gameId) {
  const { error } = await supabase.rpc('release_game_lease', { p_game_id: gameId, p_worker_id: WORKER_ID });
  if (error) console.error(`[game ${gameId}] release_game_lease failed:`, error.message);
}

async function getGameState(gameId) {
  const { data, error } = await supabase.rpc('engine_game_state', { p_game_id: gameId });
  if (error) throw new Error(`engine_game_state failed: ${error.message}`);
  return data;
}

// Keeps the lease fresh on a timer (covering long sleeps mid-round) and trips a
// flag if the lease is lost, so the driver can stop before a reclaiming worker
// starts double-broadcasting the same game.
function startHeartbeat(gameId, ctx) {
  const intervalMs = Math.max(Math.floor((LEASE_SECONDS * 1000) / 2), 1000);
  return setInterval(async () => {
    try {
      const { data, error } = await supabase.rpc('heartbeat_game_lease', {
        p_game_id: gameId,
        p_worker_id: WORKER_ID,
        p_lease_seconds: LEASE_SECONDS,
      });
      if (error) {
        console.error(`[game ${gameId}] heartbeat error:`, error.message);
      } else if (data !== true) {
        ctx.lostLease = true;
        console.error(`[game ${gameId}] lease lost (reclaimed elsewhere); stopping this driver`);
      }
    } catch (err) {
      console.error(`[game ${gameId}] heartbeat threw:`, err.message);
    }
  }, intervalMs);
}

function assertLease(ctx, gameId) {
  if (ctx.lostLease) throw new Error(`lease for game ${gameId} was lost mid-drive`);
}

// --- Game driver ---------------------------------------------------------------

// Claims a game, then drives it to completion. Skips silently if another worker
// already owns it. Owns the full lease lifecycle (heartbeat + release).
async function claimAndRun(gameId) {
  const claimed = await claimGame(gameId);
  if (!claimed) {
    console.log(`[game ${gameId}] owned by another worker; skipping`);
    return;
  }
  await runGame(gameId);
}

// Drives one game: calls the start_round/end_round/payout_game Postgres functions
// (which own all timing/scoring truth) and broadcasts their results over a
// Realtime channel dedicated to this game. Resumes from wherever a crashed worker
// left off rather than always restarting at round 1.
async function runGame(gameId) {
  const state = await getGameState(gameId);
  if (!state) {
    console.error(`[game ${gameId}] no such game; releasing`);
    await releaseGame(gameId);
    return;
  }
  if (state.status === 'completed') {
    await releaseGame(gameId);
    return;
  }

  const totalRounds = state.totalRounds;
  const ctx = { lostLease: false };
  const heartbeat = startHeartbeat(gameId, ctx);
  const channel = await subscribeChannel(gameId);
  console.log(`[game ${gameId}] driving as ${WORKER_ID} (status=${state.status}, round=${state.currentRound})`);

  try {
    // Resume decision. A game already past its final regular round (or mid
    // overtime) jumps straight to payout/overtime resolution; otherwise pick the
    // round to (re)open: fresh games start at 1, an interrupted-but-open round is
    // re-opened, an already-scored round is stepped past.
    if (state.inSuddenDeath || (state.currentRound >= totalRounds && state.currentRoundEnded)) {
      await resolvePayoutOrOvertime(channel, gameId, ctx);
    } else {
      let startRound;
      if (state.currentRound === 0) startRound = 1;
      else if (state.currentRoundEnded) startRound = state.currentRound + 1;
      else startRound = state.currentRound;
      await runRounds(channel, gameId, ctx, startRound, totalRounds);
    }
  } catch (err) {
    // Don't spam a game:error to clients over a self-inflicted lease loss - that
    // just means another healthy worker took over.
    if (!ctx.lostLease) {
      await channel.send({ type: 'broadcast', event: 'game:error', payload: { error: err.message } });
    }
    throw err;
  } finally {
    clearInterval(heartbeat);
    await supabase.removeChannel(channel);
    await releaseGame(gameId);
  }
}

async function runRounds(channel, gameId, ctx, startRound, totalRounds) {
  for (let roundNumber = startRound; roundNumber <= totalRounds; roundNumber += 1) {
    assertLease(ctx, gameId);

    const { data: round, error } = await supabase.rpc('start_round', {
      p_game_id: gameId,
      p_round_number: roundNumber,
    });
    if (error) throw new Error(`start_round(${roundNumber}) failed: ${error.message}`);

    await channel.send({ type: 'broadcast', event: 'round:start', payload: round });
    console.log(`[game ${gameId}] round ${roundNumber} started (cost ${round.costCents}c, ${round.timeLimitSeconds}s)`);

    await sleep(round.timeLimitSeconds * 1000 + LATE_ANSWER_GRACE_MS);
    assertLease(ctx, gameId);

    const { data: result, error: endError } = await supabase.rpc('end_round', {
      p_game_id: gameId,
      p_round_number: roundNumber,
    });
    if (endError) throw new Error(`end_round(${roundNumber}) failed: ${endError.message}`);

    await channel.send({ type: 'broadcast', event: 'round:end', payload: result });
    console.log(`[game ${gameId}] round ${roundNumber} ended, correct=${result.correctOption}`);

    if (result.isFinalRound) {
      // Blocks until the game actually pays out - runs Sudden Death Overtime
      // rounds internally for as long as a tie persists.
      await resolvePayoutOrOvertime(channel, gameId, ctx);
      return;
    }

    await sleep(NEXT_ROUND_DELAY_MS);
  }
}

// Calls payout_game; if it reports a tie ("status: sudden_death"), runs Sudden
// Death Overtime rounds - restricted to the tied players, flat premium fee,
// shrinking timer - until scores diverge and a real payout happens.
async function resolvePayoutOrOvertime(channel, gameId, ctx) {
  let payout = await callPayoutGame(channel, gameId);

  while (payout.status === 'sudden_death') {
    assertLease(ctx, gameId);
    console.log(`[game ${gameId}] tie at rank(s) ${payout.tiedRanks.join(', ')} - entering sudden death overtime`);
    await channel.send({ type: 'broadcast', event: 'game:sudden_death', payload: payout });

    const { data: round, error } = await supabase.rpc('start_sudden_death_round', { p_game_id: gameId });
    if (error) throw new Error(`start_sudden_death_round failed: ${error.message}`);

    await channel.send({ type: 'broadcast', event: 'round:start', payload: round });
    console.log(`[game ${gameId}] overtime round ${round.roundNumber} started (${round.timeLimitSeconds}s)`);

    await sleep(round.timeLimitSeconds * 1000 + LATE_ANSWER_GRACE_MS);
    assertLease(ctx, gameId);

    const { data: result, error: endError } = await supabase.rpc('end_round', {
      p_game_id: gameId,
      p_round_number: round.roundNumber,
    });
    if (endError) throw new Error(`end_round(overtime ${round.roundNumber}) failed: ${endError.message}`);

    await channel.send({ type: 'broadcast', event: 'round:end', payload: result });
    console.log(`[game ${gameId}] overtime round ${round.roundNumber} ended, correct=${result.correctOption}`);

    payout = await callPayoutGame(channel, gameId);
  }

  return payout;
}

async function callPayoutGame(channel, gameId) {
  const { data: payout, error } = await supabase.rpc('payout_game', { p_game_id: gameId });
  if (error) throw new Error(`payout_game failed: ${error.message}`);

  if (payout.status === 'completed') {
    await channel.send({ type: 'broadcast', event: 'game:completed', payload: payout });
    console.log(`[game ${gameId}] completed, prize pool ${payout.totalPrizePoolCents}c distributed`);
  }
  return payout;
}

// "Game Director" mode: polls for runnable games - pending (never started) and
// active-but-orphaned (a crashed worker's game whose lease has lapsed) - claims
// each atomically, and drives it. So games neither need a human to kick them off
// nor stay stuck when a worker dies mid-tournament.
const WATCH_POLL_MS = parseInt(process.env.WATCH_POLL_MS || '15000', 10);

// How often to purge the black-box ledger of entries older than 48h. Default
// hourly. (If pg_cron is enabled, prefer scheduling purge_old_websocket_logs
// there instead; this is the no-extension fallback.)
const PURGE_INTERVAL_MS = parseInt(process.env.PURGE_INTERVAL_MS || '3600000', 10);
let lastPurgeAt = 0;

async function maybePurgeLogs() {
  if (Date.now() - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = Date.now();
  const { data, error } = await supabase.rpc('purge_old_websocket_logs');
  if (error) console.error('[purge] purge_old_websocket_logs failed:', error.message);
  else if (data > 0) console.log(`[purge] removed ${data} black-box log entries older than 48h`);
}

// Auto-scheduler: keep at least MIN_JOINABLE_GAMES games in pending/active state
// at all times, rotating across all 3 modes, so the lobby is never empty and
// every mode advertised on the website is actually joinable. Runs every poll
// tick; ensure_games_available's advisory lock makes this race-free even with
// multiple Game Director instances polling concurrently.
const MIN_JOINABLE_GAMES = parseInt(process.env.MIN_JOINABLE_GAMES || '3', 10);
const AUTO_SCHEDULE = process.env.AUTO_SCHEDULE !== 'false';

async function maybeScheduleGames() {
  if (!AUTO_SCHEDULE) return;
  const { data, error } = await supabase.rpc('ensure_games_available', { p_min_joinable: MIN_JOINABLE_GAMES });
  if (error) {
    console.error('[schedule] ensure_games_available failed:', error.message);
    return;
  }
  const created = data?.created ?? [];
  if (created.length > 0) {
    console.log(
      `[schedule] created ${created.length} game(s) to reach ${MIN_JOINABLE_GAMES} joinable: ` +
        created.map((g) => `${g.mode}(${g.gameId.slice(0, 8)})`).join(', ')
    );
  }
}

async function watchPendingGames() {
  console.log(`[watch] worker ${WORKER_ID} polling for runnable games every ${WATCH_POLL_MS}ms`);
  const inFlight = new Set();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await maybeScheduleGames();

      const { data: runnable, error } = await supabase.rpc('engine_runnable_games');
      if (error) throw error;

      for (const { game_id: gameId } of runnable ?? []) {
        if (inFlight.has(gameId)) continue;
        inFlight.add(gameId);
        claimAndRun(gameId)
          .catch((err) => console.error(`[watch] game ${gameId} crashed:`, err))
          .finally(() => inFlight.delete(gameId));
      }

      await maybePurgeLogs();
    } catch (err) {
      console.error('[watch] poll failed:', err.message);
    }
    await sleep(WATCH_POLL_MS);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--watch') {
    await watchPendingGames();
    return;
  }

  const results = await Promise.allSettled(args.map(claimAndRun));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[game ${args[i]}] crashed:`, result.reason);
    }
  });
  process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
}

main();
