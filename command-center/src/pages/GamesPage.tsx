import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type GameMode = 'original_escalator' | 'streak_saver' | 'milestone_booster';
type PayoutScheme = 'standard' | 'classic_top3' | 'winner_take_most' | 'spread_the_wealth';

const PAYOUT_SCHEME_LABELS: Record<PayoutScheme, string> = {
  standard: 'Standard (field-scaled)',
  classic_top3: 'Classic top 3 (50/30/20)',
  winner_take_most: 'Winner take most (70/20/10)',
  spread_the_wealth: 'Spread the wealth (~25% of field, weighted)',
};

type EngineHealth = {
  pendingGames: number;
  activeGamesDriven: number;
  activeGamesStalled: number;
  completedGames: number;
  leaseHolders: { workerId: string; gameCount: number; oldestLeaseExpiresAt: string }[];
};

type SchedulerConfig = { minJoinableGames: number; autoScheduleEnabled: boolean };

type LeaderboardRow = {
  rank: number;
  user_id: string;
  username: string;
  total_score: number;
  current_round_reached: number;
  is_eligible_for_grand_prize: boolean;
  is_eliminated: boolean;
};

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

type ReadySubject = {
  subject_id: string;
  slug: string;
  name: string;
  domain: string;
  min_per_grade: number;
  ready: boolean;
};

export default function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [newMode, setNewMode] = useState<GameMode>('original_escalator');
  const [newPayoutScheme, setNewPayoutScheme] = useState<PayoutScheme>('standard');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [readySubjects, setReadySubjects] = useState<ReadySubject[]>([]);
  const [contestSubject, setContestSubject] = useState('');
  const [health, setHealth] = useState<EngineHealth | null>(null);
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig | null>(null);
  const [minJoinableInput, setMinJoinableInput] = useState('3');
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    if (!error && data) setGames(data as Game[]);

    const { data: subs } = await supabase.rpc('subjects_ready_for_contest');
    if (subs) setReadySubjects(subs as ReadySubject[]);
  }, []);

  const loadOperations = useCallback(async () => {
    const [{ data: h }, { data: cfg }] = await Promise.all([
      supabase.rpc('admin_engine_health'),
      supabase.rpc('admin_get_scheduler_config'),
    ]);
    if (h) setHealth(h as EngineHealth);
    if (cfg) {
      const c = cfg as SchedulerConfig;
      setSchedulerConfig(c);
      setMinJoinableInput(String(c.minJoinableGames));
    }
  }, []);

  async function publishContest() {
    if (!contestSubject) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.rpc('admin_create_subject_contest', { p_subject_id: contestSubject });
      if (error) throw error;
      const g = Array.isArray(data) ? data[0] : data;
      setMessage(`Themed contest published: game ${String(g.game_id).slice(0, 8)}… (pending — the engine will run it).`);
      setContestSubject('');
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    loadOperations();
  }, [load, loadOperations]);

  async function createGame() {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_create_game', { p_mode: newMode, p_payout_scheme: newPayoutScheme });
      if (error) throw error;
      setMessage(`Game created (${MODE_LABELS[newMode]}, ${PAYOUT_SCHEME_LABELS[newPayoutScheme]}).`);
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedulerConfig(autoScheduleEnabled: boolean) {
    const minJoinable = parseInt(minJoinableInput, 10);
    if (!Number.isInteger(minJoinable) || minJoinable <= 0) {
      setMessage('Min joinable games must be a positive integer.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_set_scheduler_config', {
        p_min_joinable_games: minJoinable,
        p_auto_schedule_enabled: autoScheduleEnabled,
      });
      if (error) throw error;
      setMessage('Scheduler config updated.');
      await loadOperations();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStandings(gameId: string) {
    if (expandedGameId === gameId) {
      setExpandedGameId(null);
      return;
    }
    setExpandedGameId(gameId);
    const { data, error } = await supabase.rpc('admin_game_leaderboard', { p_game_id: gameId });
    if (error) {
      setMessage(`Error loading standings: ${error.message}`);
      return;
    }
    setLeaderboard((data ?? []) as LeaderboardRow[]);
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

  // "Hype Machine": drafts a post-game announcement from real payout data for
  // staff to review and post themselves. This never posts anywhere on its own -
  // no social API keys are wired up, and auto-publishing a real player's
  // identity + winnings without their consent is a privacy/ToS question worth
  // a human decision, not blind automation.
  async function draftAnnouncement(gameId: string, mode: GameMode) {
    setBusy(true);
    setAnnouncement(null);
    try {
      const { data: topPayout } = await supabase
        .from('wallet_ledger')
        .select('user_id, amount_cents')
        .eq('game_id', gameId)
        .eq('entry_type', 'payout')
        .order('amount_cents', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!topPayout) {
        setMessage('No payout found for this game yet.');
        return;
      }

      const { data: profile } = await supabase.from('profiles').select('username').eq('user_id', topPayout.user_id).single();

      const amount = (topPayout.amount_cents / 100).toFixed(2);
      const draft = `This game, @${profile?.username ?? 'a player'} turned a 1-cent entry into $${amount} in cash playing ${MODE_LABELS[mode]}. New game starting soon - can you pinch the penny? #PennyPincherTrivia`;
      setAnnouncement(draft);
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
        <h3 style={{ marginTop: 0 }}>Operations</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          The game-engine worker drives every round's timer and is the only thing that isn't serverless — if it isn't
          deployed and running somewhere, games sit idle. This panel is the fastest way to see whether it's actually
          alive.
        </p>
        {health && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{health.activeGamesDriven}</div>
              <div style={{ color: '#9a9aa5', fontSize: 12 }}>Active &amp; driven</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: health.activeGamesStalled > 0 ? '#ef4444' : undefined }}>
                {health.activeGamesStalled}
              </div>
              <div style={{ color: '#9a9aa5', fontSize: 12 }}>Active &amp; stalled (no live worker!)</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{health.pendingGames}</div>
              <div style={{ color: '#9a9aa5', fontSize: 12 }}>Pending</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{health.completedGames}</div>
              <div style={{ color: '#9a9aa5', fontSize: 12 }}>Completed</div>
            </div>
          </div>
        )}
        {health && health.activeGamesStalled > 0 && (
          <p style={{ color: '#ef4444', fontSize: 13 }}>
            {health.activeGamesStalled} active game(s) have no live worker lease. Either the game-engine worker isn't
            deployed, or it crashed and hasn't reclaimed them yet.
          </p>
        )}
        {health && health.leaseHolders.length > 0 && (
          <p style={{ color: '#9a9aa5', fontSize: 12 }}>
            Live workers: {health.leaseHolders.map((h) => `${h.workerId} (${h.gameCount} game${h.gameCount === 1 ? '' : 's'})`).join(', ')}
          </p>
        )}
        <button className="secondary" onClick={loadOperations} disabled={busy} style={{ marginBottom: 16 }}>
          Refresh
        </button>

        <h3>Auto-scheduler</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Keeps the lobby stocked by auto-creating games (rotated across all 3 modes) whenever fewer than this many are
          joinable. Takes effect on the worker's next poll tick — no redeploy needed.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ color: '#9a9aa5', fontSize: 13 }}>Min joinable games</label>
          <input
            type="number"
            min={1}
            max={50}
            value={minJoinableInput}
            onChange={(e) => setMinJoinableInput(e.target.value)}
            style={{ maxWidth: 80 }}
          />
          <button onClick={() => saveSchedulerConfig(true)} disabled={busy}>
            Save &amp; enable
          </button>
          <button className="danger" onClick={() => saveSchedulerConfig(false)} disabled={busy}>
            Save &amp; disable auto-scheduling
          </button>
          {schedulerConfig && (
            <span className={`badge ${schedulerConfig.autoScheduleEnabled ? 'resolved' : 'open'}`}>
              {schedulerConfig.autoScheduleEnabled ? 'Auto-schedule ON' : 'Auto-schedule OFF'}
            </span>
          )}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={newMode} onChange={(e) => setNewMode(e.target.value as GameMode)} style={{ maxWidth: 240 }}>
            {(Object.keys(MODE_LABELS) as GameMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
          <select
            value={newPayoutScheme}
            onChange={(e) => setNewPayoutScheme(e.target.value as PayoutScheme)}
            style={{ maxWidth: 280 }}
          >
            {(Object.keys(PAYOUT_SCHEME_LABELS) as PayoutScheme[]).map((s) => (
              <option key={s} value={s}>
                {PAYOUT_SCHEME_LABELS[s]}
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
        <h3 style={{ marginTop: 0 }}>Publish a themed contest</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Builds a 100-round game from a single subject (5 questions per grade level). Only subjects with ≥5 approved
          questions at every grade level are ready. Generate the questions with the curator (
          <code>question-curator</code>) first.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select value={contestSubject} onChange={(e) => setContestSubject(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Select a ready subject…</option>
            {readySubjects
              .filter((s) => s.ready)
              .map((s) => (
                <option key={s.subject_id} value={s.subject_id}>
                  {s.name} ({s.domain})
                </option>
              ))}
          </select>
          <button onClick={publishContest} disabled={busy || !contestSubject}>
            + Publish contest
          </button>
        </div>
        {readySubjects.filter((s) => s.ready).length === 0 && (
          <p style={{ color: '#9a9aa5', marginTop: 10, fontSize: 13 }}>
            No subjects are contest-ready yet. Use the curator to generate questions, approve them in the Question Bank,
            then they'll appear here.
          </p>
        )}
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
              <React.Fragment key={g.game_id}>
                <tr>
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
                    <button className="secondary" onClick={() => toggleStandings(g.game_id)} disabled={busy}>
                      {expandedGameId === g.game_id ? 'Hide standings' : 'View standings'}
                    </button>
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
                    {g.status === 'completed' && (
                      <button className="secondary" onClick={() => draftAnnouncement(g.game_id, g.mode)} disabled={busy}>
                        Draft announcement
                      </button>
                    )}
                  </td>
                </tr>
                {expandedGameId === g.game_id && (
                  <tr>
                    <td colSpan={8}>
                      {leaderboard.length === 0 ? (
                        <p style={{ color: '#9a9aa5', margin: '8px 0' }}>No players have entered this game yet.</p>
                      ) : (
                        <table style={{ margin: '8px 0' }}>
                          <thead>
                            <tr>
                              <th>Rank</th>
                              <th>Player</th>
                              <th>Score</th>
                              <th>Round reached</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaderboard.map((row) => (
                              <tr key={row.user_id}>
                                <td>{row.rank}</td>
                                <td>{row.username}</td>
                                <td>{row.total_score}</td>
                                <td>{row.current_round_reached}</td>
                                <td>
                                  {row.is_eliminated && <span className="badge open">eliminated</span>}
                                  {!row.is_eliminated && !row.is_eligible_for_grand_prize && (
                                    <span className="badge open">flagged / ineligible</span>
                                  )}
                                  {!row.is_eliminated && row.is_eligible_for_grand_prize && (
                                    <span className="badge resolved">in contention</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {games.length === 0 && (
              <tr>
                <td colSpan={8}>No games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {announcement && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Announcement draft</h3>
          <p style={{ color: '#9a9aa5', fontSize: 13 }}>
            Generated from real payout data - review before posting anywhere. Not auto-posted: no social API keys are
            configured, and posting a real player's identity + winnings without their consent is a judgment call, not
            something to automate blindly.
          </p>
          <textarea readOnly value={announcement} rows={3} />
        </div>
      )}
    </div>
  );
}
