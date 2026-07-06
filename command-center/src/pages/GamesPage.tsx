import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type GameMode = 'original_escalator' | 'streak_saver' | 'milestone_booster';

type Game = {
  game_id: string;
  status: string;
  mode: GameMode;
  current_round: number;
  total_rounds: number;
  total_prize_pool_cents: number;
  admin_revenue_pool_cents: number;
  in_sudden_death: boolean;
  created_at: string;
};

const MODE_LABELS: Record<GameMode, string> = {
  original_escalator: 'Flat-Rate Escalator',
  streak_saver: 'Streak Saver',
  milestone_booster: 'Milestone Booster',
};

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [newMode, setNewMode] = useState<GameMode>('original_escalator');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    if (!error && data) setGames(data as Game[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createGame() {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_create_game', { p_mode: newMode });
      if (error) throw error;
      setMessage(`Game created (${MODE_LABELS[newMode]}).`);
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function forcePayout(gameId: string) {
    if (!confirm('Force payout for this game now? This is irreversible.')) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('admin_force_payout', { p_game_id: gameId });
      if (error) throw error;
      setMessage(
        data.status === 'sudden_death'
          ? `Tie detected at rank(s) ${data.tiedRanks.join(', ')} - game moved to Sudden Death Overtime instead of paying out.`
          : 'Payout distributed.'
      );
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function startOvertimeRound(gameId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_start_sudden_death_round', { p_game_id: gameId });
      if (error) throw error;
      setMessage('Overtime round started.');
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Games</h2>
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={newMode} onChange={(e) => setNewMode(e.target.value as GameMode)} style={{ maxWidth: 240 }}>
            {(Object.keys(MODE_LABELS) as GameMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <button onClick={createGame} disabled={busy}>
            + Create new game
          </button>
        </div>
        {message && <p style={{ marginTop: 12 }}>{message}</p>}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Game ID</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Round</th>
              <th>Prize Pool</th>
              <th>Platform Cut</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.game_id}>
                <td>{g.game_id.slice(0, 8)}...</td>
                <td>{MODE_LABELS[g.mode]}</td>
                <td>
                  {g.status}
                  {g.in_sudden_death && <span className="badge open" style={{ marginLeft: 6 }}>SUDDEN DEATH</span>}
                </td>
                <td>
                  {g.current_round} / {g.total_rounds}
                </td>
                <td>${(g.total_prize_pool_cents / 100).toFixed(2)}</td>
                <td>${(g.admin_revenue_pool_cents / 100).toFixed(2)}</td>
                <td>{new Date(g.created_at).toLocaleString()}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {g.status === 'active' && g.current_round >= g.total_rounds && !g.in_sudden_death && (
                    <button className="secondary" onClick={() => forcePayout(g.game_id)} disabled={busy}>
                      Force payout
                    </button>
                  )}
                  {g.in_sudden_death && (
                    <>
                      <button className="secondary" onClick={() => startOvertimeRound(g.game_id)} disabled={busy}>
                        Start overtime round
                      </button>
                      <button className="secondary" onClick={() => forcePayout(g.game_id)} disabled={busy}>
                        Re-check tie
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr>
                <td colSpan={8}>No games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
