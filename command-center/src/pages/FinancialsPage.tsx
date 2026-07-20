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
  created_at: string;
};

type DailyHouseMoney = { date: string; games: number; houseMoneyCents: number };

type Reconciliation = {
  gameId: string;
  status: string;
  expectedPool: number;
  actualPool: number;
  payouts: number;
  poolMatches: boolean;
  payoutMatches: boolean;
};

export default function FinancialsPage() {
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [totals, setTotals] = useState({ prizePools: 0, platformRevenue: 0, gamesCompleted: 0 });
  const [games, setGames] = useState<Game[]>([]);
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

    const { data: gameRows } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    if (gameRows) {
      const g = gameRows as Game[];
      setGames(g);
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
  // that total_prize_pool_cents + admin_revenue_pool_cents exactly equals the
  // CASH players actually contributed (entry fees + round costs, cash portion
  // only) - and, for completed games, that the payouts issued exactly equal
  // the prize pool. Down to the cent, no estimates - a mismatch here means
  // real money is unaccounted for.
  //
  // Source of truth is player_game_stats.total_cash_spent_cents, NOT
  // wallet_ledger's round_debit entries: round_debit records the FULL round
  // cost including any promo/bonus-token-funded portion, but promo-funded
  // spending contributes nothing to the pool (buy_round only cuts the
  // cash-funded remainder into prize_cut/admin_cut). Summing round_debit
  // overstates the expected pool by however much was paid in bonus tokens -
  // increasingly common now with deposit bonus tokens, Streak Saver's free
  // rounds, and the "3 the hard way" streak bonus all crediting promo
  // balance. total_cash_spent_cents already tracks only the cash-funded
  // portion (both the entry fee and every round's cash_used), so it's exactly
  // what should sum to total_prize_pool_cents + admin_revenue_pool_cents.
  async function runReconciliation() {
    setReconcileBusy(true);
    try {
      const { data: games } = await supabase.from('games').select('*').in('status', ['active', 'completed']);
      const { data: statsRows } = await supabase.from('player_game_stats').select('game_id, total_cash_spent_cents');
      const { data: payoutRows } = await supabase.from('wallet_ledger').select('game_id, amount_cents').eq('entry_type', 'payout');

      const sumBy = (rows: { game_id: string | null; amount_cents: number }[] | null, gameId: string) =>
        (rows ?? []).filter((r) => r.game_id === gameId).reduce((sum, r) => sum + Math.abs(r.amount_cents), 0);
      const sumCashBy = (rows: { game_id: string; total_cash_spent_cents: number }[] | null, gameId: string) =>
        (rows ?? []).filter((r) => r.game_id === gameId).reduce((sum, r) => sum + r.total_cash_spent_cents, 0);

      const results: Reconciliation[] = ((games ?? []) as Game[]).map((g) => {
        const expectedPool = sumCashBy(statsRows, g.game_id);
        const payouts = sumBy(payoutRows, g.game_id);
        const actualPool = g.total_prize_pool_cents + g.admin_revenue_pool_cents;
        return {
          gameId: g.game_id,
          status: g.status,
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

  // House money = the platform's 40% cut (games.admin_revenue_pool_cents), which
  // accrues on the game row as rounds are bought. Bucketed by the game's local
  // creation date - a game runs ~30 min end-to-end, so this is an accurate proxy
  // for "money taken in that day" even though the cut technically trickles in
  // round-by-round rather than posting as a single ledger entry.
  const localDateKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const todayKey = localDateKey(new Date().toISOString());
  const dailyHouseMoney: DailyHouseMoney[] = Array.from(
    games.reduce((byDate, g) => {
      const key = localDateKey(g.created_at);
      const entry = byDate.get(key) ?? { date: key, games: 0, houseMoneyCents: 0 };
      entry.games += 1;
      entry.houseMoneyCents += g.admin_revenue_pool_cents;
      byDate.set(key, entry);
      return byDate;
    }, new Map<string, DailyHouseMoney>()).values()
  ).sort((a, b) => (a.date < b.date ? 1 : -1));
  const houseMoneyToday = dailyHouseMoney.find((d) => d.date === todayKey)?.houseMoneyCents ?? 0;
  const houseMoneyAllTime = games.reduce((sum, g) => sum + g.admin_revenue_pool_cents, 0);

  return (
    <div>
      <h2>Financials</h2>

      <div className="stat-grid" style={{ marginBottom: 24 }}>
        <div className="stat">
          <div className="label">Total Prize Pools</div>
          <div className="value">${(totals.prizePools / 100).toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">House Money Today</div>
          <div className="value">${(houseMoneyToday / 100).toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">House Money — All Games (40% cut)</div>
          <div className="value">${(houseMoneyAllTime / 100).toFixed(2)}</div>
        </div>
        <div className="stat">
          <div className="label">Games Completed</div>
          <div className="value">{totals.gamesCompleted}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>House money by day</h3>
        <p style={{ color: '#9a9aa5', fontSize: 13, marginTop: 0 }}>
          The platform's 40% cut, grouped by the day each game was created.
        </p>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Games</th>
              <th>House Money</th>
            </tr>
          </thead>
          <tbody>
            {dailyHouseMoney.slice(0, 30).map((d) => (
              <tr key={d.date}>
                <td>{d.date}{d.date === todayKey ? ' (today)' : ''}</td>
                <td>{d.games}</td>
                <td>${(d.houseMoneyCents / 100).toFixed(2)}</td>
              </tr>
            ))}
            {dailyHouseMoney.length === 0 && (
              <tr>
                <td colSpan={3}>No games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>House money by game</h3>
        <table>
          <thead>
            <tr>
              <th>Game</th>
              <th>Created</th>
              <th>Status</th>
              <th>Prize Pool</th>
              <th>House Money</th>
            </tr>
          </thead>
          <tbody>
            {games.slice(0, 50).map((g) => (
              <tr key={g.game_id}>
                <td>{g.game_id.slice(0, 8)}...</td>
                <td>{new Date(g.created_at).toLocaleString()}</td>
                <td>{g.status}</td>
                <td>${(g.total_prize_pool_cents / 100).toFixed(2)}</td>
                <td>${(g.admin_revenue_pool_cents / 100).toFixed(2)}</td>
              </tr>
            ))}
            {games.length === 0 && (
              <tr>
                <td colSpan={5}>No games yet.</td>
              </tr>
            )}
          </tbody>
        </table>
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
                <th>Cash Contributed</th>
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
          <option value="bonus_grant">bonus_grant</option>
          <option value="entry_fee_debit">entry_fee_debit</option>
          <option value="round_debit">round_debit</option>
          <option value="streak_bonus">streak_bonus</option>
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
