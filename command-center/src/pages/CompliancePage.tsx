import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type CheatFlag = { id: string; user_id: string; game_id: string | null; round_number: number | null; reason: string; created_at: string };
type FlaggedPlayer = {
  user_id: string;
  username: string;
  game_id: string;
  mode: string;
  flag_count: number;
  flags: { roundNumber: number; reason: string; createdAt: string }[];
  is_eligible_for_grand_prize: boolean | null;
  is_eliminated: boolean | null;
};
type Profile = { user_id: string; username: string; is_suspended: boolean; wallet_balance_cents: number };
const MODE_LABELS_FALLBACK: Record<string, string> = {
  original_escalator: 'Flat-Rate Escalator',
  streak_saver: 'Streak Saver',
  milestone_booster: 'Milestone Booster',
};

type KycRow = {
  user_id: string;
  username: string;
  kyc_status: string;
  date_of_birth: string | null;
  region_state: string | null;
  lifetime_winnings_cents: number;
  tax_details_confirmed: boolean;
};

export default function CompliancePage() {
  const [flags, setFlags] = useState<CheatFlag[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [blockedStates, setBlockedStates] = useState('');
  const [allowedStates, setAllowedStates] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kycFilter, setKycFilter] = useState('pending');
  const [kycRows, setKycRows] = useState<KycRow[]>([]);
  const [flaggedPlayers, setFlaggedPlayers] = useState<FlaggedPlayer[]>([]);

  const loadFlaggedPlayers = useCallback(async () => {
    const { data } = await supabase.rpc('admin_list_cheat_flags', { p_game_id: null, p_limit: 100 });
    if (data) setFlaggedPlayers(data as FlaggedPlayer[]);
  }, []);

  const load = useCallback(async () => {
    const { data: flagData } = await supabase.from('cheat_flags').select('*').order('created_at', { ascending: false }).limit(100);
    if (flagData) setFlags(flagData as CheatFlag[]);

    const userIds = Array.from(new Set((flagData ?? []).map((f: CheatFlag) => f.user_id)));
    if (userIds.length > 0) {
      const { data: profileData } = await supabase.from('profiles').select('user_id, username, is_suspended, wallet_balance_cents').in('user_id', userIds);
      const map: Record<string, Profile> = {};
      (profileData ?? []).forEach((p: Profile) => (map[p.user_id] = p));
      setProfiles(map);
    }

    const { data: cfg } = await supabase
      .from('platform_config')
      .select('key, value')
      .in('key', ['blocked_states', 'allowed_states']);
    const blocked = cfg?.find((c) => c.key === 'blocked_states')?.value as string[] | undefined;
    const allowed = cfg?.find((c) => c.key === 'allowed_states')?.value as string[] | undefined;
    if (blocked) setBlockedStates(blocked.join(', '));
    if (allowed) setAllowedStates(allowed.join(', '));
  }, []);

  const loadKyc = useCallback(async () => {
    let q = supabase
      .from('profiles')
      .select('user_id, username, kyc_status, date_of_birth, region_state, lifetime_winnings_cents, tax_details_confirmed')
      .order('kyc_verified_at', { ascending: false, nullsFirst: true })
      .limit(100);
    if (kycFilter) q = q.eq('kyc_status', kycFilter);
    const { data } = await q;
    if (data) setKycRows(data as KycRow[]);
  }, [kycFilter]);

  useEffect(() => {
    load();
    loadFlaggedPlayers();
  }, [load, loadFlaggedPlayers]);

  useEffect(() => {
    loadKyc();
  }, [loadKyc]);

  async function reinstate(userId: string, gameId: string) {
    const reason = prompt('Reason for reinstating grand-prize eligibility? (reviewed and confirmed not cheating)') ?? '';
    if (!reason) return;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_reinstate_eligibility', { p_user_id: userId, p_game_id: gameId, p_reason: reason });
      if (error) throw error;
      setMessage('Grand-prize eligibility reinstated for this game.');
      await loadFlaggedPlayers();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuspend(userId: string, suspend: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const reason = prompt(suspend ? 'Reason for suspension?' : 'Reason for reinstatement?') ?? '';
      const { error } = await supabase.rpc('admin_suspend_account', { p_user_id: userId, p_suspend: suspend, p_reason: reason });
      if (error) throw error;
      setMessage(suspend ? 'Account suspended.' : 'Account reinstated.');
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function setKyc(userId: string, status: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_set_kyc_status', { p_user_id: userId, p_status: status });
      if (error) throw error;
      setMessage(`KYC status set to ${status}.`);
      await loadKyc();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveBlockedStates() {
    setBusy(true);
    setMessage(null);
    try {
      const states = blockedStates.split(',').map((s) => s.trim()).filter(Boolean);
      const { error } = await supabase.rpc('admin_update_blocked_states', { p_states: states });
      if (error) throw error;
      setMessage('Blocked-states list updated.');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAllowedStates() {
    setBusy(true);
    setMessage(null);
    try {
      const states = allowedStates
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
      const { error } = await supabase.rpc('admin_update_allowed_states', { p_states: states });
      if (error) throw error;
      setMessage('Allowed-states (whitelist) updated.');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2>Compliance</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Allowed states (launch whitelist)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Comma-separated state codes where real-money play is permitted. <strong>This is the primary geo-fence</strong>:
          when non-empty, <em>only</em> these states can buy in — every other region is blocked by default. Launch set per
          the rollout plan: <code>TX, CA, NY, OH, PA</code>. Leave empty to fall back to blocklist-only. Confirm with
          counsel (see <code>legal/01-state-restrictions.md</code>).
        </p>
        <textarea rows={2} value={allowedStates} onChange={(e) => setAllowedStates(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button onClick={saveAllowedStates} disabled={busy}>
            Save whitelist
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Blocked states / territories (denylist override)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Comma-separated state codes to hard-block even if otherwise allowed. Applied on top of the whitelist above.
        </p>
        <textarea rows={2} value={blockedStates} onChange={(e) => setBlockedStates(e.target.value)} />
        <div style={{ marginTop: 8 }}>
          <button onClick={saveBlockedStates} disabled={busy}>
            Save
          </button>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>KYC / identity review</h3>
          <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="unverified">Unverified</option>
            <option value="">All</option>
          </select>
        </div>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Verification normally flows in automatically from the KYC vendor (Persona/Stripe Identity) via the{' '}
          <code>kyc-webhook</code> function. Manual override here is for edge cases only - it's the gate on withdrawals
          (verified + 18+ required).
        </p>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>KYC</th>
              <th>DOB</th>
              <th>State</th>
              <th>Lifetime winnings</th>
              <th>Tax</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {kycRows.map((r) => (
              <tr key={r.user_id}>
                <td>{r.username}</td>
                <td>
                  <span className={`badge ${r.kyc_status === 'verified' ? 'resolved' : r.kyc_status === 'rejected' ? 'open' : 'in_progress'}`}>
                    {r.kyc_status}
                  </span>
                </td>
                <td>{r.date_of_birth ?? '-'}</td>
                <td>{r.region_state ?? '-'}</td>
                <td>${(r.lifetime_winnings_cents / 100).toFixed(2)}</td>
                <td>{r.tax_details_confirmed ? 'confirmed' : '-'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {r.kyc_status !== 'verified' && (
                    <button onClick={() => setKyc(r.user_id, 'verified')} disabled={busy}>
                      Verify
                    </button>
                  )}
                  {r.kyc_status !== 'rejected' && (
                    <button className="danger" onClick={() => setKyc(r.user_id, 'rejected')} disabled={busy}>
                      Reject
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {kycRows.length === 0 && (
              <tr>
                <td colSpan={7}>No players match this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Grand-prize eligibility (per game)</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          submit_answer auto-disqualifies a player from a game's grand prize after 3 velocity flags (or 2 on
          high-value rounds ≥80). That heuristic can false-positive on a genuinely fast player. Review the flag
          history below and reinstate if it wasn't cheating - this restores eligibility for that game only; the
          flag history itself is never erased.
        </p>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Game</th>
              <th>Flags</th>
              <th>Standing</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flaggedPlayers.map((p) => (
              <tr key={`${p.user_id}-${p.game_id}`}>
                <td>{p.username}</td>
                <td>
                  {MODE_LABELS_FALLBACK[p.mode] ?? p.mode} ({p.game_id.slice(0, 8)}...)
                </td>
                <td title={p.flags.map((f) => `Round ${f.roundNumber}: ${f.reason}`).join('\n')}>{p.flag_count}</td>
                <td>
                  {p.is_eliminated && <span className="badge open">eliminated</span>}
                  {!p.is_eliminated && p.is_eligible_for_grand_prize === false && (
                    <span className="badge open">disqualified from prize</span>
                  )}
                  {!p.is_eliminated && p.is_eligible_for_grand_prize !== false && <span className="badge resolved">eligible</span>}
                </td>
                <td>
                  {p.is_eligible_for_grand_prize === false && !p.is_eliminated && (
                    <button className="secondary" onClick={() => reinstate(p.user_id, p.game_id)} disabled={busy}>
                      Reinstate eligibility
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {flaggedPlayers.length === 0 && (
              <tr>
                <td colSpan={5}>No flagged players.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Anti-cheat flags</h3>
        {message && <p>{message}</p>}
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Player</th>
              <th>Round</th>
              <th>Reason</th>
              <th>Wallet</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => {
              const profile = profiles[f.user_id];
              return (
                <tr key={f.id}>
                  <td>{new Date(f.created_at).toLocaleString()}</td>
                  <td>{profile?.username ?? f.user_id.slice(0, 8)}</td>
                  <td>{f.round_number}</td>
                  <td>{f.reason}</td>
                  <td>{profile ? `$${(profile.wallet_balance_cents / 100).toFixed(2)}` : '-'}</td>
                  <td>
                    {profile && (
                      <button
                        className={profile.is_suspended ? 'secondary' : 'danger'}
                        onClick={() => toggleSuspend(f.user_id, !profile.is_suspended)}
                        disabled={busy}
                      >
                        {profile.is_suspended ? 'Reinstate' : 'Suspend'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {flags.length === 0 && (
              <tr>
                <td colSpan={6}>No flags recorded.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
