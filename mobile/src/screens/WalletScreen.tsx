import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const BUNDLES = [
  { id: 'starter', label: '$1.00 -> 100 Tokens' },
  { id: 'small', label: '$5.00 -> 600 Tokens' },
  { id: 'medium', label: '$10.00 -> 1300 Tokens' },
  { id: 'large', label: '$20.00 -> 2800 Tokens' },
];

type Compliance = {
  kycStatus: string;
  isAdult: boolean;
  lifetimeWinningsCents: number;
  taxDetailsConfirmed: boolean;
  taxThresholdCents: number;
  regionState: string | null;
  regionBlocked: boolean;
  walletBalanceCents: number;
};

export default function WalletScreen() {
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_compliance_status');
    if (error) {
      Alert.alert('Error loading wallet', error.message);
      return;
    }
    setCompliance(data as Compliance);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
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

  async function withdraw() {
    const cents = Math.round(parseFloat(withdrawAmount) * 100);
    if (!Number.isInteger(cents) || cents <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive dollar amount.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('withdraw', { body: { cents } });
      if (error) throw error;
      Alert.alert('Withdrawal requested', 'Your payout is on its way.');
      setWithdrawAmount('');
      await load();
    } catch (err) {
      // Surface the specific compliance gate the server enforced.
      Alert.alert('Withdrawal blocked', (err as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmTax() {
    setBusy(true);
    try {
      // In production this opens Stripe Tax's hosted W-9 flow; here it just flips
      // the gate so the rest of the flow can be exercised.
      const { error } = await supabase.rpc('confirm_tax_details');
      if (error) throw error;
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Dev/test-only: funds the wallet directly without a real Stripe purchase.
  async function devCredit() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('dev_credit_wallet', { p_cents: 1000 });
      if (error) throw error;
      await load();
    } catch (err) {
      Alert.alert('Dev credit failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const c = compliance;
  const nearTaxThreshold = c ? c.lifetimeWinningsCents >= c.taxThresholdCents && !c.taxDetailsConfirmed : false;
  const canWithdraw = c ? c.kycStatus === 'verified' && c.isAdult && !nearTaxThreshold : false;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.balanceLabel}>Wallet Balance</Text>
      <Text style={styles.balance}>{c === null ? '...' : `$${(c.walletBalanceCents / 100).toFixed(2)}`}</Text>

      {BUNDLES.map((bundle) => (
        <Pressable key={bundle.id} style={styles.button} onPress={() => buyBundle(bundle.id)} disabled={busy}>
          <Text style={styles.buttonText}>{bundle.label}</Text>
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>Cash out</Text>

      {c && c.kycStatus !== 'verified' && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Verify your identity to withdraw. You can play and load funds now; ID verification (name, date of birth, 18+)
            is required before cashing out.
          </Text>
        </View>
      )}
      {c && c.kycStatus === 'verified' && !c.isAdult && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>You must be at least 18 years old to withdraw winnings.</Text>
        </View>
      )}
      {nearTaxThreshold && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            You're approaching the federal tax reporting threshold. Please confirm your tax details to continue cashing out.
          </Text>
          <Pressable style={styles.smallButton} onPress={confirmTax} disabled={busy}>
            <Text style={styles.buttonText}>Confirm tax details</Text>
          </Pressable>
        </View>
      )}

      <TextInput
        style={styles.input}
        placeholder="Amount to withdraw ($)"
        placeholderTextColor="#6a6a75"
        keyboardType="decimal-pad"
        value={withdrawAmount}
        onChangeText={setWithdrawAmount}
      />
      <Pressable
        style={[styles.button, !canWithdraw && styles.buttonDisabled]}
        onPress={withdraw}
        disabled={busy || !canWithdraw}
      >
        <Text style={styles.buttonText}>{canWithdraw ? 'Withdraw' : 'Withdrawal locked'}</Text>
      </Pressable>

      <Pressable style={styles.devButton} onPress={devCredit} disabled={busy}>
        {busy ? <ActivityIndicator color="#0f0f14" /> : <Text style={styles.buttonText}>Dev: +$10.00 (testing only)</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  balanceLabel: { color: '#9a9aa5', fontSize: 14, marginTop: 24, textAlign: 'center' },
  balance: { color: '#fff', fontSize: 48, fontWeight: '800', textAlign: 'center', marginBottom: 32 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 12 },
  button: { backgroundColor: '#1c1c24', borderRadius: 10, paddingVertical: 14, marginBottom: 12 },
  buttonDisabled: { opacity: 0.5 },
  smallButton: { backgroundColor: '#22c55e', borderRadius: 8, paddingVertical: 10, marginTop: 10 },
  devButton: { backgroundColor: '#f59e0b', borderRadius: 10, paddingVertical: 14, marginTop: 24 },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700', fontSize: 16 },
  input: {
    backgroundColor: '#1c1c24',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  notice: { backgroundColor: '#f59e0b22', borderRadius: 10, padding: 14, marginBottom: 12 },
  noticeText: { color: '#f59e0b', fontSize: 14 },
});
