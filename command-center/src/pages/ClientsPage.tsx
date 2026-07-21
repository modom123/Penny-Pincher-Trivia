import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Client = {
  user_id: string;
  client_number: number;
  username: string;
  email: string;
  wallet_balance_cents: number;
  promo_balance_cents: number;
  lifetime_winnings_cents: number;
  kyc_status: string;
  region_state: string | null;
  is_suspended: boolean;
  stripe_customer_id: string | null;
  stripe_connect_account_id: string | null;
  created_at: string;
};

const KYC_LABEL: Record<string, string> = {
  unverified: 'Unverified',
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.rpc('list_clients', { p_search: q || null });
    if (error) setError(error.message);
    else setClients((data ?? []) as Client[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  function copyId(userId: string) {
    navigator.clipboard?.writeText(userId);
    setCopiedId(userId);
    setTimeout(() => setCopiedId((c) => (c === userId ? null : c)), 1500);
  }

  return (
    <div>
      <h2>Clients</h2>
      <p style={{ color: '#9a9aa5', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        Every signed-up player - client number, email, balances, and KYC/region status. Search by username, email, or
        client number. Copy a client's ID to paste into Support's wallet-credit / activity-log lookups.
      </p>

      <div className="card">
        <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <input
            style={{ flex: 1 }}
            placeholder="Search by username, email, or client #"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
          {search && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setSearch('');
                load('');
              }}
            >
              Clear
            </button>
          )}
        </form>

        <table>
          <thead>
            <tr>
              <th>Client #</th>
              <th>Username</th>
              <th>Email</th>
              <th>Wallet</th>
              <th>Promo</th>
              <th>Lifetime winnings</th>
              <th>KYC</th>
              <th>Region</th>
              <th>Status</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.user_id}>
                <td style={{ fontWeight: 700 }}>#{c.client_number}</td>
                <td>{c.username}</td>
                <td>{c.email}</td>
                <td>${(c.wallet_balance_cents / 100).toFixed(2)}</td>
                <td>${(c.promo_balance_cents / 100).toFixed(2)}</td>
                <td>${(c.lifetime_winnings_cents / 100).toFixed(2)}</td>
                <td>{KYC_LABEL[c.kyc_status] ?? c.kyc_status}</td>
                <td>{c.region_state ?? '-'}</td>
                <td style={{ color: c.is_suspended ? '#FF4D7D' : '#12E29A' }}>
                  {c.is_suspended ? 'Suspended' : 'Active'}
                </td>
                <td style={{ color: '#9a9aa5', whiteSpace: 'nowrap' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="secondary" onClick={() => copyId(c.user_id)}>
                    {copiedId === c.user_id ? 'Copied!' : 'Copy ID'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {error && <p style={{ color: '#ef4444' }}>Error loading clients: {error}</p>}
        {!error && clients.length === 0 && !loading && <p style={{ color: '#9a9aa5' }}>No clients match that search.</p>}
      </div>
    </div>
  );
}
