require('dotenv').config();
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NEXT_ROUND_DELAY_MS = parseInt(process.env.NEXT_ROUND_DELAY_MS || '4000', 10);
const LATE_ANSWER_GRACE_MS = parseInt(process.env.LATE_ANSWER_GRACE_MS || '500', 10);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}

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

// Drives one game's 100-round loop: calls the start_round/end_round/payout_game
// Postgres functions (which own all timing/scoring truth) and broadcasts their
// results to connected clients over a Realtime channel dedicated to this game.
async function runGame(gameId) {
  const channel = await subscribeChannel(gameId);
  console.log(`[game ${gameId}] subscribed to realtime channel`);

  try {
    let roundNumber = 1;
    while (roundNumber <= 100) {
      const { data: round, error } = await supabase.rpc('start_round', {
        p_game_id: gameId,
        p_round_number: roundNumber,
      });
      if (error) throw new Error(`start_round(${roundNumber}) failed: ${error.message}`);

      await channel.send({ type: 'broadcast', event: 'round:start', payload: round });
      console.log(`[game ${gameId}] round ${roundNumber} started (cost ${round.costCents}c, ${round.timeLimitSeconds}s)`);

      await sleep(round.timeLimitSeconds * 1000 + LATE_ANSWER_GRACE_MS);

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
        await resolvePayoutOrOvertime(channel, gameId);
        break;
      }

      await sleep(NEXT_ROUND_DELAY_MS);
      roundNumber += 1;
    }
  } catch (err) {
    await channel.send({ type: 'broadcast', event: 'game:error', payload: { error: err.message } });
    throw err;
  } finally {
    await supabase.removeChannel(channel);
  }
}

// Calls payout_game; if it reports a tie ("status: sudden_death"), runs
// Sudden Death Overtime rounds - restricted to the tied players, flat premium
// fee, shrinking timer - until scores diverge and a real payout happens.
async function resolvePayoutOrOvertime(channel, gameId) {
  let payout = await callPayoutGame(channel, gameId);

  while (payout.status === 'sudden_death') {
    console.log(`[game ${gameId}] tie at rank(s) ${payout.tiedRanks.join(', ')} - entering sudden death overtime`);
    await channel.send({ type: 'broadcast', event: 'game:sudden_death', payload: payout });

    const { data: round, error } = await supabase.rpc('start_sudden_death_round', { p_game_id: gameId });
    if (error) throw new Error(`start_sudden_death_round failed: ${error.message}`);

    await channel.send({ type: 'broadcast', event: 'round:start', payload: round });
    console.log(`[game ${gameId}] overtime round ${round.roundNumber} started (${round.timeLimitSeconds}s)`);

    await sleep(round.timeLimitSeconds * 1000 + LATE_ANSWER_GRACE_MS);

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

// "Game Director" mode: polls the games table for pending games no one has
// started yet and runs them automatically, so games don't need a human (or a
// one-off script invocation) to kick each one off.
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

// Liveness beacon so the Command Center can tell the worker itself is up (not
// just infer it from games advancing). One row per engine instance, refreshed
// every poll. Uses the service_role client, which bypasses RLS.
const INSTANCE_ID = `${os.hostname()}:${process.pid}`;

async function recordHeartbeat(gamesInFlight) {
  const { error } = await supabase.from('engine_heartbeats').upsert(
    {
      instance_id: INSTANCE_ID,
      last_heartbeat_at: new Date().toISOString(),
      games_in_flight: gamesInFlight,
    },
    { onConflict: 'instance_id' }
  );
  if (error) console.error('[heartbeat] failed:', error.message);
}

async function watchPendingGames() {
  console.log(`[watch] polling for pending games every ${WATCH_POLL_MS}ms`);
  const inFlight = new Set();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { data: pending, error } = await supabase.from('games').select('game_id').eq('status', 'pending');
      if (error) throw error;

      for (const { game_id: gameId } of pending ?? []) {
        if (inFlight.has(gameId)) continue;
        inFlight.add(gameId);
        console.log(`[watch] starting pending game ${gameId}`);
        runGame(gameId)
          .catch((err) => console.error(`[watch] game ${gameId} crashed:`, err))
          .finally(() => inFlight.delete(gameId));
      }

      await recordHeartbeat(inFlight.size);
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

  const results = await Promise.allSettled(args.map(runGame));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[game ${args[i]}] crashed:`, result.reason);
    }
  });
  process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
}

main();
