import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type LedgerRow = {
  id: string;
  user_id: string;
  entry_type: string;
  amount_cents: number;
  game_id: string | null;
  stripe_ref: string | null;
  created_at: string;
};

type Game = { total_prize_pool_cents: number; admin_revenue_pool_cents: number; status: string };

export default function FinancialsPage() {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [totals, setTotals] = useState({ prizePools: 0, platformRevenue: 0, gamesCompleted: 0 });
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    (async () => {
      const { data: ledgerData } = await supabase
        .from('wallet_ledger')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (ledgerData) setLedger(ledgerData as LedgerRow[]);

      const { data: games } = await supabase.from('games').select('total_prize_pool_cents, admin_revenue_pool_cents, status');
      if (games) {
        const g = games as Game[];
        setTotals({
          prizePools: g.reduce((sum, x) => sum + x.total_prize_pool_cents, 0),
          platformRevenue: g.reduce((sum, x) => sum + x.admin_revenue_pool_cents, 0),
          gamesCompleted: g.filter((x) => x.status === 'completed').length,
        });
      }
    })();
  }, []);

  const filtered = ledger.filter((row) => !filterType || row.entry_type === filterType);

  return (
    <div>
      <h2>Financials</h2>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">Total Prize Pools</div>
          <div className="value">${(totals.prizePools / 100).toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">Platform Revenue (40% cut)</div>
          <div className="value">${(totals.platformRevenue / 100).toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">Games Completed</div>
          <div className="value">{totals.gamesCompleted}</div>
        </div>
      </div>

      <div className="card">
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ marginBottom: 12, maxWidth: 220 }}>
          <option value="">All entry types</option>
          <option value="deposit">deposit</option>
          <option value="round_debit">round_debit</option>
          <option value="payout">payout</option>
          <option value="withdrawal">withdrawal</option>
          <option value="admin_adjustment">admin_adjustment</option>
        </select>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Amount</th>
              <th>User</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.entry_type}</td>
                <td style={{ color: row.amount_cents >= 0 ? '#22c55e' : '#ef4444' }}>
                  {row.amount_cents >= 0 ? '+' : ''}${(row.amount_cents / 100).toFixed(2)}
                </td>
                <td>{row.user_id.slice(0, 8)}...</td>
                <td>{row.stripe_ref ?? (row.game_id ? `game ${row.game_id.slice(0, 8)}...` : '-')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
