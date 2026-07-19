import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type TopWinner = { user_id: string; username: string; lifetime_winnings_cents: number };

type GameOption = { game_id: string; mode: string; status: string; created_at: string };

type LeaderboardRow = {
  rank: number;
  user_id: string;
  username: string;
  total_score: number;
  total_cash_spent_cents: number;
  is_eliminated: boolean;
  is_eligible_for_grand_prize: boolean;
};

const MODE_LABELS: Record<string, string> = {
  original_escalator: 'Flat-Rate Escalator',
  streak_saver: 'Streak Saver',
  milestone_booster: 'Milestone Booster',
};

export default function LeaderboardsPage() {
  const [topWinners, setTopWinners] = useState<TopWinner[]>([]);
  const [games, setGames] = useState<GameOption[]>([]);
  const [selectedGame, setSelectedGame] = useState('');
  const [gameLeaderboard, setGameLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loadingGame, setLoadingGame] = useState(false);

  const load = useCallback(async () => {
    const { data: winners } = await supabase.rpc('list_top_winners', { p_limit: 50 });
    if (winners) setTopWinners(winners as TopWinner[]);

    const { data: gameRows } = await supabase
      .from('games')
      .select('game_id, mode, status, created_at')
      .in('status', ['active', 'completed'])
      .order('created_at', { ascending: false })
      .limit(100);
    if (gameRows) setGames(gameRows as GameOption[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadGameLeaderboard = useCallback(async (gameId: string) => {
    setSelectedGame(gameId);
    if (!gameId) {
      setGameLeaderboard([]);
      return;
    }
    setLoadingGame(true);
    const { data } = await supabase.rpc('get_game_leaderboard', { p_game_id: gameId, p_limit: 100 });
    setGameLeaderboard((data as LeaderboardRow[]) ?? []);
    setLoadingGame(false);
  }, []);

  return (
    <div>
      <h2>Leaderboards</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>All-time Top Winners</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>Ranked by lifetime cash winnings across every completed game.</p>
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Lifetime winnings</th>
            </tr>
          </thead>
          <tbody>
            {topWinners.map((w, i) => (
              <tr key={w.user_id}>
                <td>{i + 1}</td>
                <td>{w.username}</td>
                <td>${(w.lifetime_winnings_cents / 100).toFixed(2)}</td>
              </tr>
            ))}
            {topWinners.length === 0 && (
              <tr>
                <td colSpan={3}>No payouts recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Per-game standings</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Ranked by total score, ties broken by least cash spent (see the Rulebook for scoring details).
        </p>
        <select value={selectedGame} onChange={(e) => loadGameLeaderboard(e.target.value)} style={{ maxWidth: 420, marginBottom: 12 }}>
          <option value="">Select a game…</option>
          {games.map((g) => (
            <option key={g.game_id} value={g.game_id}>
              {g.game_id.slice(0, 8)}… · {MODE_LABELS[g.mode] ?? g.mode} · {g.status} · {new Date(g.created_at).toLocaleDateString()}
            </option>
          ))}
        </select>
        {loadingGame && <p>Loading…</p>}
        {!loadingGame && selectedGame && (
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Score</th>
                <th>Cash spent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {gameLeaderboard.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.rank}</td>
                  <td>{row.username}</td>
                  <td>{row.total_score}</td>
                  <td>${(row.total_cash_spent_cents / 100).toFixed(2)}</td>
                  <td>
                    {row.is_eliminated ? (
                      <span className="badge open">Eliminated</span>
                    ) : !row.is_eligible_for_grand_prize ? (
                      <span className="badge open">Disqualified</span>
                    ) : (
                      <span className="badge resolved">In it</span>
                    )}
                  </td>
                </tr>
              ))}
              {gameLeaderboard.length === 0 && (
                <tr>
                  <td colSpan={5}>No answers submitted yet for this game.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
