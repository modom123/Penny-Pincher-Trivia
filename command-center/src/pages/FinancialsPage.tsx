import React, { useCallback, useEffect, useState } from 'react';
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

type Game = {
  game_id: string;
  total_prize_pool_cents: number;
  admin_revenue_pool_cents: number;
  status: string;
};

type Reconciliation = {
  gameId: string;
  status: string;
  debits: number;
  bonuses: number;
  expectedPool: number;
  actualPool: number;
  payouts: number;
  poolMatches: boolean;
  payoutMatches: boolean;
};

export default function FinancialsPage() {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [totals, setTotals] = useState({ prizePools: 0, platformRevenue: 0, gamesCompleted: 0 });
  const [filterType, setFilterType] = useState('');
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [reconcileBusy, setReconcileBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: ledgerData } = await supabase
      .from('wallet_ledger')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (ledgerData) setLedger(ledgerData as LedgerRow[]);

    const { data: games } = await supabase.from('games').select('*');
    if (games) {
      const g = games as Game[];
      setTotals({
        prizePools: g.reduce((sum, x) => sum + x.total_prize_pool_cents, 0),
        platformRevenue: g.reduce((sum, x) => sum + x.admin_revenue_pool_cents, 0),
        gamesCompleted: g.filter((x) => x.status === 'completed').length,
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // "Ledger Master" reconciliation: for every active/completed game, verify
  // that total_prize_pool_cents + admin_revenue_pool_cents exactly equals
  // what players actually paid in (round_debit ledger entries) plus any
  // platform-funded milestone bonuses - and, for completed games, that the
  // payouts issued exactly equal the prize pool. Down to the cent, no
  // estimates - a mismatch here means real money is unaccounted for.
  async function runReconciliation() {
    setReconcileBusy(true);
    try {
      const { data: games } = await supabase.from('games').select('*').in('status', ['active', 'completed']);
      const { data: debitRows } = await supabase.from('wallet_ledger').select('game_id, amount_cents').eq('entry_type', 'round_debit');
      const { data: payoutRows } = await supabase.from('wallet_ledger').select('game_id, amount_cents').eq('entry_type', 'payout');
      const { data: bonusRows } = await supabase.from('game_bonus_injections').select('game_id, amount_cents');

      const sumBy = (rows: { game_id: string | null; amount_cents: number }[] | null, gameId: string) =>
        (rows ?? []).filter((r) => r.game_id === gameId).reduce((sum, r) => sum + Math.abs(r.amount_cents), 0);

      const results: Reconciliation[] = ((games ?? []) as Game[]).map((g) => {
        const debits = sumBy(debitRows, g.game_id);
        const bonuses = sumBy(bonusRows, g.game_id);
        const payouts = sumBy(payoutRows, g.game_id);
        const expectedPool = debits + bonuses;
        const actualPool = g.total_prize_pool_cents + g.admin_revenue_pool_cents;
        return {
          gameId: g.game_id,
          status: g.status,
          debits,
          bonuses,
          expectedPool,
          actualPool,
          payouts,
          poolMatches: expectedPool === actualPool,
          payoutMatches: g.status !== 'completed' || payouts === g.total_prize_pool_cents,
        };
      });
      setReconciliations(results);
    } finally {
      setReconcileBusy(false);
    }
  }

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Ledger reconciliation</h3>
          <button onClick={runReconciliation} disabled={reconcileBusy}>
            {reconcileBusy ? 'Checking...' : 'Run reconciliation'}
          </button>
        </div>
        {reconciliations.length > 0 && (
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Game</th>
                <th>Status</th>
                <th>Debits + Bonuses</th>
                <th>Pool + Cut</th>
                <th>Payouts</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.map((r) => (
                <tr key={r.gameId}>
                  <td>{r.gameId.slice(0, 8)}...</td>
                  <td>{r.status}</td>
                  <td>${(r.expectedPool / 100).toFixed(2)}</td>
                  <td>${(r.actualPool / 100).toFixed(2)}</td>
                  <td>{r.status === 'completed' ? `$${(r.payouts / 100).toFixed(2)}` : '-'}</td>
                  <td>
                    {r.poolMatches && r.payoutMatches ? (
                      <span className="badge resolved">OK</span>
                    ) : (
                      <span className="badge open">MISMATCH</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
