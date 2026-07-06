require('dotenv').config();
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
        const { data: payout, error: payoutError } = await supabase.rpc('payout_game', { p_game_id: gameId });
        if (payoutError) throw new Error(`payout_game failed: ${payoutError.message}`);

        await channel.send({ type: 'broadcast', event: 'game:completed', payload: payout });
        console.log(`[game ${gameId}] completed, prize pool ${payout.totalPrizePoolCents}c distributed`);
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

async function main() {
  const gameIds = process.argv.slice(2);
  if (gameIds.length === 0) {
    console.error('Usage: node index.js <gameId> [gameId2 ...]');
    process.exit(1);
  }

  const results = await Promise.allSettled(gameIds.map(runGame));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[game ${gameIds[i]}] crashed:`, result.reason);
    }
  });
  process.exit(results.some((r) => r.status === 'rejected') ? 1 : 0);
}

main();
