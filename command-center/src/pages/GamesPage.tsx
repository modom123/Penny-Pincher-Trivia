import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Game = {
  game_id: string;
  status: string;
  current_round: number;
  total_rounds: number;
  total_prize_pool_cents: number;
  admin_revenue_pool_cents: number;
  created_at: string;
};

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    if (!error && data) setGames(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createGame() {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_create_game');
      if (error) throw error;
      setMessage('Game created.');
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
      const { error } = await supabase.rpc('admin_force_payout', { p_game_id: gameId });
      if (error) throw error;
      setMessage('Payout distributed.');
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
        <button onClick={createGame} disabled={busy}>
          + Create new game
        </button>
        {message && <p style={{ marginTop: 12 }}>{message}</p>}
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Game ID</th>
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
                <td>{g.status}</td>
                <td>
                  {g.current_round} / {g.total_rounds}
                </td>
                <td>${(g.total_prize_pool_cents / 100).toFixed(2)}</td>
                <td>${(g.admin_revenue_pool_cents / 100).toFixed(2)}</td>
                <td>{new Date(g.created_at).toLocaleString()}</td>
                <td>
                  {g.status === 'active' && g.current_round >= g.total_rounds && (
                    <button className="secondary" onClick={() => forcePayout(g.game_id)} disabled={busy}>
                      Force payout
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr>
                <td colSpan={7}>No games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
