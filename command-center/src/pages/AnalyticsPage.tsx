import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type GameMode = 'original_escalator' | 'streak_saver' | 'milestone_booster';
const MODE_LABELS: Record<GameMode, string> = {
  original_escalator: 'Flat-Rate Escalator',
  streak_saver: 'Streak Saver',
  milestone_booster: 'Milestone Booster',
};

type ModeStats = { mode: GameMode; games: number; players: number; revenueCents: number };

export default function AnalyticsPage() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalGames: 0,
    activeGames: 0,
    totalAnswers: 0,
    totalCheatFlags: 0,
    suspendedAccounts: 0,
  });
  const [modeStats, setModeStats] = useState<ModeStats[]>([]);

  useEffect(() => {
    (async () => {
      const [{ count: totalUsers }, { count: totalGames }, { count: activeGames }, { count: totalAnswers }, { count: totalCheatFlags }, { count: suspendedAccounts }] =
        await Promise.all([
          supabase.from('profiles').select('*', { count: 'exact', head: true }),
          supabase.from('games').select('*', { count: 'exact', head: true }),
          supabase.from('games').select('*', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('player_answers').select('*', { count: 'exact', head: true }),
          supabase.from('cheat_flags').select('*', { count: 'exact', head: true }),
          supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_suspended', true),
        ]);
      setStats({
        totalUsers: totalUsers ?? 0,
        totalGames: totalGames ?? 0,
        activeGames: activeGames ?? 0,
        totalAnswers: totalAnswers ?? 0,
        totalCheatFlags: totalCheatFlags ?? 0,
        suspendedAccounts: suspendedAccounts ?? 0,
      });

      // "Campaign Commander" decision support: which mode is driving the most
      // play and revenue, for a human to act on manually. This build does NOT
      // auto-shift real ad budgets across Meta/Google Ads - that moves real
      // money without a human approving it, which is out of scope for
      // automation here. See README's Workforce section.
      const { data: games } = await supabase.from('games').select('game_id, mode, admin_revenue_pool_cents');
      const { data: playerGames } = await supabase.from('player_game_stats').select('game_id');

      const modeByGameId = new Map<string, GameMode>();
      const gamesByMode = new Map<GameMode, { games: number; revenueCents: number }>();
      (games ?? []).forEach((g: { game_id: string; mode: GameMode; admin_revenue_pool_cents: number }) => {
        modeByGameId.set(g.game_id, g.mode);
        const existing = gamesByMode.get(g.mode) ?? { games: 0, revenueCents: 0 };
        existing.games += 1;
        existing.revenueCents += g.admin_revenue_pool_cents;
        gamesByMode.set(g.mode, existing);
      });

      const playersByMode = new Map<GameMode, number>();
      (playerGames ?? []).forEach((pg: { game_id: string }) => {
        const mode = modeByGameId.get(pg.game_id);
        if (mode) playersByMode.set(mode, (playersByMode.get(mode) ?? 0) + 1);
      });

      setModeStats(
        (Object.keys(MODE_LABELS) as GameMode[]).map((mode) => ({
          mode,
          games: gamesByMode.get(mode)?.games ?? 0,
          revenueCents: gamesByMode.get(mode)?.revenueCents ?? 0,
          players: playersByMode.get(mode) ?? 0,
        }))
      );
    })();
  }, []);

  return (
    <div>
      <h2>Analytics</h2>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Total Players</div>
          <div className="value">{stats.totalUsers}</div>
        </div>
        <div className="stat">
          <div className="label">Total Games</div>
          <div className="value">{stats.totalGames}</div>
        </div>
        <div className="stat">
          <div className="label">Active Games</div>
          <div className="value">{stats.activeGames}</div>
        </div>
        <div className="stat">
          <div className="label">Answers Submitted</div>
          <div className="value">{stats.totalAnswers}</div>
        </div>
        <div className="stat">
          <div className="label">Anti-cheat Flags</div>
          <div className="value">{stats.totalCheatFlags}</div>
        </div>
        <div className="stat">
          <div className="label">Suspended Accounts</div>
          <div className="value">{stats.suspendedAccounts}</div>
        </div>
      </div>
      <p style={{ color: '#9a9aa5', marginTop: 24, fontSize: 13 }}>
        These are live counts from the database, not time-series analytics. A proper analytics pipeline (DAU/revenue over
        time, retention cohorts) would need either scheduled aggregate rollups or a dedicated analytics store - worth
        scoping separately once there's real traffic to analyze.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Performance by game mode</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          For deciding where to point marketing spend manually. This build does not auto-shift ad budgets across
          Meta/Google Ads the way a fully autonomous "Campaign Commander" would - that moves real money without a human
          approving it, which is intentionally out of scope for automation here.
        </p>
        <table>
          <thead>
            <tr>
              <th>Mode</th>
              <th>Games</th>
              <th>Player-Games</th>
              <th>Platform Revenue</th>
            </tr>
          </thead>
          <tbody>
            {modeStats.map((m) => (
              <tr key={m.mode}>
                <td>{MODE_LABELS[m.mode]}</td>
                <td>{m.games}</td>
                <td>{m.players}</td>
                <td>${(m.revenueCents / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
