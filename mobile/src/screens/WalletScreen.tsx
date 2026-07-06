import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const BUNDLES = [
  { id: 'small', label: '$5.00 -> 500 Tokens' },
  { id: 'medium', label: '$20.00 -> 2000 Tokens' },
  { id: 'large', label: '$50.00 -> 5000 Tokens' },
];

export default function WalletScreen() {
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBalance = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('wallet_balance_cents').single();
    if (error) {
      Alert.alert('Error loading wallet', error.message);
      return;
    }
    setBalanceCents(data.wallet_balance_cents);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBalance();
    }, [loadBalance])
  );

  async function buyBundle(bundleId: string) {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { bundleId } });
      if (error) throw error;
      Alert.alert('Checkout', `Open this URL to complete payment:\n${data.checkoutUrl}`);
    } catch (err) {
      Alert.alert('Checkout failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Dev/test-only: funds the wallet directly without a real Stripe purchase.
  // See public.dev_credit_wallet in the Supabase migrations - revoke that
  // function's EXECUTE grant from `authenticated` before a production launch.
  async function devCredit() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('dev_credit_wallet', { p_cents: 1000 });
      if (error) throw error;
      await loadBalance();
    } catch (err) {
      Alert.alert('Dev credit failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.balanceLabel}>Wallet Balance</Text>
      <Text style={styles.balance}>{balanceCents === null ? '...' : `$${(balanceCents / 100).toFixed(2)}`}</Text>

      {BUNDLES.map((bundle) => (
        <Pressable key={bundle.id} style={styles.button} onPress={() => buyBundle(bundle.id)} disabled={busy}>
          <Text style={styles.buttonText}>{bundle.label}</Text>
        </Pressable>
      ))}

      <Pressable style={styles.devButton} onPress={devCredit} disabled={busy}>
        {busy ? <ActivityIndicator color="#0f0f14" /> : <Text style={styles.buttonText}>Dev: +$10.00 (testing only)</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  balanceLabel: { color: '#9a9aa5', fontSize: 14, marginTop: 24, textAlign: 'center' },
  balance: { color: '#fff', fontSize: 48, fontWeight: '800', textAlign: 'center', marginBottom: 32 },
  button: { backgroundColor: '#1c1c24', borderRadius: 10, paddingVertical: 14, marginBottom: 12 },
  devButton: { backgroundColor: '#f59e0b', borderRadius: 10, paddingVertical: 14, marginTop: 24 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: 16 },
});
