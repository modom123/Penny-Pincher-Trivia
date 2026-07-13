import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView, TextInput, Platform, Linking, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';

const isWeb = Platform.OS === 'web';

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
  promoBalanceCents: number;
  withdrawableCents: number;
};

type Referral = {
  referralCode: string;
  rewardPerReferralCents: number;
  totalReferred: number;
  rewardedCount: number;
  pendingCount: number;
  tokensEarnedCents: number;
};

export default function WalletScreen() {
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [referral, setReferral] = useState<Referral | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data, error }, { data: ref }] = await Promise.all([
      supabase.rpc('my_compliance_status'),
      supabase.rpc('my_referral_status'),
    ]);
    if (error) {
      Alert.alert('Error loading wallet', error.message);
      return;
    }
    setCompliance(data as Compliance);
    if (ref) setReferral(ref as Referral);
  }, []);

  async function shareInvite() {
    if (!referral) return;
    const reward = `${referral.rewardPerReferralCents} tokens`;
    const message =
      `Play Penny Pincher Trivia with me! Use my referral code ${referral.referralCode} when you sign up ` +
      `— once you play your first round, I get ${reward}.`;
    try {
      if (isWeb && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(message);
        Alert.alert('Copied', 'Your invite was copied to the clipboard.');
      } else {
        await Share.share({ message });
      }
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Returning from Stripe Checkout on web (…/wallet/success?session_id=…): the
  // webhook credits asynchronously, so poll a couple of times to reflect the new
  // balance, then clean the URL.
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('session_id') && !window.location.pathname.includes('/wallet/success')) return;
    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      await load();
      if (tries >= 4) clearInterval(iv);
    }, 1500);
    window.history.replaceState({}, '', window.location.pathname.replace('/wallet/success', '/'));
    return () => clearInterval(iv);
  }, [load]);

  async function buyBundle(bundleId: string) {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { bundleId } });
      if (error) throw error;
      // Web-to-app funding (the launch playbook's "payment loophole"): send the
      // player to Stripe Checkout in the browser; the webhook credits the wallet
      // and Supabase Realtime syncs the balance back into the app on return.
      if (isWeb && typeof window !== 'undefined') {
        window.location.assign(data.checkoutUrl);
      } else {
        Linking.openURL(data.checkoutUrl);
      }
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
      <Text style={styles.balanceLabel}>Token Balance</Text>
      <Text style={styles.balance}>{c === null ? '...' : `$${(c.walletBalanceCents / 100).toFixed(2)}`}</Text>

      {c !== null && (
        <View style={styles.splitRow}>
          <View style={styles.splitCell}>
            <Text style={styles.splitValueCash}>${(c.withdrawableCents / 100).toFixed(2)}</Text>
            <Text style={styles.splitLabel}>Cash · withdrawable</Text>
          </View>
          <View style={styles.splitDivider} />
          <View style={styles.splitCell}>
            <Text style={styles.splitValueBonus}>${(c.promoBalanceCents / 100).toFixed(2)}</Text>
            <Text style={styles.splitLabel}>Bonus · play-only</Text>
          </View>
        </View>
      )}
      {c !== null && c.promoBalanceCents > 0 && (
        <Text style={styles.splitNote}>
          Bonus tokens play just like cash, but only your cash balance can be withdrawn.
        </Text>
      )}

      {BUNDLES.map((bundle) => (
        <Pressable key={bundle.id} style={styles.button} onPress={() => buyBundle(bundle.id)} disabled={busy}>
          <Text style={styles.buttonText}>{bundle.label}</Text>
        </Pressable>
      ))}

      {referral && (
        <View style={styles.referralCard}>
          <Text style={styles.referralTitle}>Refer a friend</Text>
          <Text style={styles.referralBlurb}>
            Earn {referral.rewardPerReferralCents} tokens when a friend signs up with your code and plays their first
            round.
          </Text>
          <Pressable onPress={shareInvite} style={styles.referralCodeBox}>
            <Text style={styles.referralCode}>{referral.referralCode ?? '—'}</Text>
            <Text style={styles.referralCodeHint}>{isWeb ? 'Tap to copy invite' : 'Tap to share invite'}</Text>
          </Pressable>
          <View style={styles.referralStatsRow}>
            <View style={styles.referralStat}>
              <Text style={styles.referralStatValue}>{referral.rewardedCount}</Text>
              <Text style={styles.referralStatLabel}>Joined</Text>
            </View>
            <View style={styles.referralStat}>
              <Text style={styles.referralStatValue}>{referral.pendingCount}</Text>
              <Text style={styles.referralStatLabel}>Pending</Text>
            </View>
            <View style={styles.referralStat}>
              <Text style={styles.referralStatValue}>${(referral.tokensEarnedCents / 100).toFixed(2)}</Text>
              <Text style={styles.referralStatLabel}>Earned</Text>
            </View>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>Cash out</Text>
      {c !== null && (
        <Text style={styles.withdrawableHint}>
          Withdrawable cash: ${(c.withdrawableCents / 100).toFixed(2)}
        </Text>
      )}

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

      {/* Dev-only self-credit is hidden on web. Server-side, dev_credit_wallet is
          admin-staff only and credits non-withdrawable promo, so it can't mint cash. */}
      {!isWeb && (
        <Pressable style={styles.devButton} onPress={devCredit} disabled={busy}>
          {busy ? <ActivityIndicator color="#0f0f14" /> : <Text style={styles.buttonText}>Dev: +$10.00 (testing only)</Text>}
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  balanceLabel: { color: '#9a9aa5', fontSize: 14, marginTop: 24, textAlign: 'center' },
  balance: { color: '#fff', fontSize: 48, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  splitRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1c1c24', borderRadius: 12, paddingVertical: 14, marginBottom: 8 },
  splitCell: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: '#2c2c36' },
  splitValueCash: { color: '#22c55e', fontSize: 22, fontWeight: '800' },
  splitValueBonus: { color: '#f5c542', fontSize: 22, fontWeight: '800' },
  splitLabel: { color: '#9a9aa5', fontSize: 12, marginTop: 4 },
  splitNote: { color: '#6a6a75', fontSize: 12, textAlign: 'center', marginBottom: 24 },
  withdrawableHint: { color: '#22c55e', fontSize: 13, marginBottom: 12 },
  sectionTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  referralCard: { backgroundColor: '#12211a', borderWidth: 1, borderColor: '#22c55e55', borderRadius: 12, padding: 16, marginTop: 24 },
  referralTitle: { color: '#22c55e', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  referralBlurb: { color: '#9a9aa5', fontSize: 13, marginBottom: 12 },
  referralCodeBox: { backgroundColor: '#0f0f14', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  referralCode: { color: '#fff', fontSize: 26, fontWeight: '800', letterSpacing: 3 },
  referralCodeHint: { color: '#22c55e', fontSize: 12, marginTop: 4 },
  referralStatsRow: { flexDirection: 'row' },
  referralStat: { flex: 1, alignItems: 'center' },
  referralStatValue: { color: '#fff', fontSize: 18, fontWeight: '800' },
  referralStatLabel: { color: '#9a9aa5', fontSize: 11, marginTop: 2 },
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
