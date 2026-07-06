import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AnalyticsPage() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalGames: 0,
    activeGames: 0,
    totalAnswers: 0,
    totalCheatFlags: 0,
    suspendedAccounts: 0,
  });

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
    </div>
  );
}
