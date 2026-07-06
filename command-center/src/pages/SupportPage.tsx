import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Ticket = {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  assigned_staff_user_id: string | null;
  created_at: string;
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [creditUserId, setCreditUserId] = useState('');
  const [creditCents, setCreditCents] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <div>
      <h2>Support</h2>

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
