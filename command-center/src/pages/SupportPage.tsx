import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  assigned_staff_user_id: string | null;
  game_id: string | null;
  round_number: number | null;
  created_at: string;
};

type LogEntry = {
  id: string;
  game_id: string | null;
  round_number: number | null;
  event_type: string;
  client_timestamp_ms: number | null;
  server_time_taken_ms: number | null;
  detail: Record<string, unknown> | null;
  server_received_at: string;
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [creditUserId, setCreditUserId] = useState('');
  const [creditCents, setCreditCents] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logUserId, setLogUserId] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logBusy, setLogBusy] = useState(false);
  const [logMessage, setLogMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    if (data) setTickets(data as Ticket[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function updateTicket(id: string, status: string, assignToSelf: boolean) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_update_ticket', { p_ticket_id: id, p_status: status, p_assign_to_self: assignToSelf });
      if (error) throw error;
      await load();
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitCredit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await supabase.rpc('admin_credit_wallet', {
        p_user_id: creditUserId,
        p_cents: creditCents,
        p_reason: creditReason,
      });
      if (error) throw error;
      setMessage('Wallet adjusted.');
      setCreditUserId('');
      setCreditCents(0);
      setCreditReason('');
    } catch (err) {
      setMessage(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // Dispute desk: pull a player's black-box log to adjudicate a "my answer
  // didn't submit / I got cut off" dispute. Shows the server-observed timing
  // that reserve/submit_answer actually enforced against.
  async function pullLog(userId: string) {
    setLogBusy(true);
    setLogMessage(null);
    setLogs([]);
    try {
      const { data, error } = await supabase.rpc('staff_get_player_log', { p_user_id: userId, p_limit: 100 });
      if (error) throw error;
      setLogs((data ?? []) as LogEntry[]);
      if (!data || data.length === 0) setLogMessage('No black-box events for this player in the last 48h.');
    } catch (err) {
      setLogMessage(`Error: ${(err as Error).message}`);
    } finally {
      setLogBusy(false);
    }
  }

  return (
    <div>
      <h2>Support</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Dispute desk - black-box log</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13 }}>
          Pull a player's forensic event log (kept 48h) to adjudicate timing disputes.{' '}
          <code>server_time_taken_ms</code> is what the server actually enforced against - e.g. "your tap hit our server
          at 12,010ms, past the 12,000ms cutoff".
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input placeholder="Player User ID (uuid)" value={logUserId} onChange={(e) => setLogUserId(e.target.value)} />
          <button onClick={() => pullLog(logUserId)} disabled={logBusy || !logUserId}>
            {logBusy ? 'Loading...' : 'Pull log'}
          </button>
        </div>
        {logMessage && <p style={{ marginTop: 12 }}>{logMessage}</p>}
        {logs.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Server received</th>
                <th>Event</th>
                <th>Round</th>
                <th>Server time taken (ms)</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.server_received_at).toLocaleString()}</td>
                  <td>{l.event_type}</td>
                  <td>{l.round_number ?? '-'}</td>
                  <td>{l.server_time_taken_ms ?? '-'}</td>
                  <td style={{ fontSize: 12, color: '#9a9aa5' }}>{l.detail ? JSON.stringify(l.detail) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Manual wallet adjustment / refund</h3>
        <form onSubmit={submitCredit}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr auto', gap: 10 }}>
            <input placeholder="User ID (uuid)" value={creditUserId} onChange={(e) => setCreditUserId(e.target.value)} required />
            <input
              type="number"
              placeholder="Cents (+/-)"
              value={creditCents || ''}
              onChange={(e) => setCreditCents(Number(e.target.value))}
              required
            />
            <input placeholder="Reason" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} required />
            <button type="submit" disabled={busy}>
              Apply
            </button>
          </div>
        </form>
        {message && <p style={{ marginTop: 12 }}>{message}</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tickets</h3>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Subject</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>
                  <strong>{t.subject}</strong>
                  <div style={{ color: '#9a9aa5', fontSize: 13 }}>{t.message}</div>
                </td>
                <td>
                  <span className={`badge ${t.status}`}>{t.status}</span>
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="secondary"
                    onClick={() => {
                      setLogUserId(t.user_id);
                      pullLog(t.user_id);
                    }}
                    disabled={logBusy}
                  >
                    Black box
                  </button>
                  {t.status === 'open' && (
                    <button className="secondary" onClick={() => updateTicket(t.id, 'in_progress', true)} disabled={busy}>
                      Claim
                    </button>
                  )}
                  {t.status !== 'resolved' && (
                    <button onClick={() => updateTicket(t.id, 'resolved', false)} disabled={busy}>
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={4}>No tickets.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
