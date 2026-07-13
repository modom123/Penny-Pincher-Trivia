import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import EngineStatus from '../components/EngineStatus';

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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [readySubjects, setReadySubjects] = useState<ReadySubject[]>([]);
  const [contestSubject, setContestSubject] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    if (!error && data) setGames(data as Game[]);

    const { data: subs } = await supabase.rpc('subjects_ready_for_contest');
    if (subs) setReadySubjects(subs as ReadySubject[]);
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2>Games</h2>
        <EngineStatus />
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
                  {g.status === 'completed' && (
                    <button className="secondary" onClick={() => draftAnnouncement(g.game_id, g.mode)} disabled={busy}>
                      Draft announcement
                    </button>
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
