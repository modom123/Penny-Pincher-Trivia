import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet, ActivityIndicator, ScrollView, TextInput, Platform, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, edgeFunctionErrorMessage } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { theme } from '../theme';

const isWeb = Platform.OS === 'web';

// Same 5 bundles, names, and art as the website's token grid - keep both in sync.
const BUNDLES = [
  { id: 'starter', name: 'The First Dollar', price: '$1.00', tokens: '100 Tokens', bonus: null, art: require('../../assets/tokens/the-first-dollar.png') },
  { id: 'small', name: "Lincoln's Fiver", price: '$5.00', tokens: '600 Tokens', bonus: '+100 bonus', art: require('../../assets/tokens/lincolns-fiver.png') },
  { id: 'medium', name: 'Ten Dollar Treasury', price: '$10.00', tokens: '1,400 Tokens', bonus: '+400 bonus', art: require('../../assets/tokens/ten-dollar-treasury.png'), popular: true },
  { id: 'large', name: "Jackson's Wreath", price: '$20.00', tokens: '3,000 Tokens', bonus: '+1,000 bonus', art: require('../../assets/tokens/jacksons-wreath.png') },
  { id: 'huge', name: "Grant's Fifty", price: '$50.00', tokens: '7,000 Tokens', bonus: '+2,000 bonus', art: require('../../assets/tokens/grants-fifty.png'), bestValue: true },
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
  trustlyLinked: boolean;
};

// Web: navigate the current tab/window. Native: hand off to the OS browser.
// Used for the Trustly-hosted bank-authorization page - "go complete this
// elsewhere, then come back".
function openUrl(url: string) {
  if (isWeb && typeof window !== 'undefined') {
    window.location.assign(url);
  } else {
    Linking.openURL(url);
  }
}

export default function WalletScreen() {
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_compliance_status');
    if (error) {
      showAlert('Error loading wallet', error.message);
      return;
    }
    setCompliance(data as Compliance);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Desktop: the Trustly-hosted flow opens in the system browser (the app
  // window won't navigate to an untrusted origin - see desktop/main.js), so
  // the return-leg reload the web polling effect below relies on never
  // happens in here. Refresh when the user switches back to the app instead;
  // the webhook has usually already applied the result by then.
  useEffect(() => {
    const bridge = (window as any)?.electronBridge;
    if (!bridge) return;
    return bridge.onWindowFocus(() => load());
  }, [load]);

  // Returning from Trustly's hosted bank-authorization page: it appends
  // ?transactionId=... to returnUrl (see trustly-establish-bank-auth).
  // Nothing has confirmed that id server-side yet, so this call (not just a
  // wallet reload) is what actually links it - trustly-confirm-bank-auth
  // re-checks status with Trustly rather than trusting this param at face
  // value, and applies the Trustly ID identity-verification result too.
  const RETURN_PATH = '/wallet/trustly-return';
  useEffect(() => {
    if (!isWeb || typeof window === 'undefined') return;
    if (!window.location.pathname.includes(RETURN_PATH)) return;
    const params = new URLSearchParams(window.location.search);
    const transactionId = params.get('transactionId');

    if (transactionId) {
      supabase.functions
        .invoke('trustly-confirm-bank-auth', { body: { transactionId } })
        .then(({ error }) => {
          if (error) edgeFunctionErrorMessage(error).then((msg) => showAlert('Could not link bank account', msg));
        })
        .finally(load);
    }

    let tries = 0;
    const iv = setInterval(async () => {
      tries += 1;
      await load();
      if (tries >= 4) clearInterval(iv);
    }, 1500);
    window.history.replaceState({}, '', window.location.pathname.replace(RETURN_PATH, '/'));
    return () => clearInterval(iv);
  }, [load]);

  async function buyBundle(bundleId: string) {
    if (!compliance?.trustlyLinked) {
      showAlert('Link a bank account first', 'Link your bank account below, then come back to buy tokens.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('trustly-create-deposit', { body: { bundleId } });
      if (error) throw error;
      // Trustly pulls from the already-authorized bank account - there's no
      // hosted page to redirect to, just a pending capture to poll for.
      showAlert('Purchase submitted', "We're processing your bank transfer - your tokens will appear once it clears.");
      await load();
    } catch (err) {
      showAlert('Checkout failed', await edgeFunctionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function linkBankAccount() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('trustly-establish-bank-auth');
      if (error) throw error;
      openUrl(data.url);
    } catch (err) {
      showAlert('Could not start bank linking', await edgeFunctionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    const cents = Math.round(parseFloat(withdrawAmount) * 100);
    if (!Number.isInteger(cents) || cents <= 0) {
      showAlert('Invalid amount', 'Enter a positive dollar amount.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke('withdraw', { body: { cents } });
      if (error) throw error;
      showAlert('Withdrawal requested', 'Your payout is on its way.');
      setWithdrawAmount('');
      await load();
    } catch (err) {
      // Surface the specific compliance gate the server enforced.
      showAlert('Withdrawal blocked', await edgeFunctionErrorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function confirmTax() {
    setBusy(true);
    try {
      // In production this opens the tax vendor's hosted W-9 flow; here it
      // just flips the gate so the rest of the flow can be exercised.
      const { error } = await supabase.rpc('confirm_tax_details');
      if (error) throw error;
      await load();
    } finally {
      setBusy(false);
    }
  }

  // Dev/test-only: funds the wallet directly without a real bank transfer.
  async function devCredit() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('dev_credit_wallet', { p_cents: 1000 });
      if (error) throw error;
      await load();
    } catch (err) {
      showAlert('Dev credit failed', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const c = compliance;
  const nearTaxThreshold = c ? c.lifetimeWinningsCents >= c.taxThresholdCents && !c.taxDetailsConfirmed : false;
  const canWithdraw = c ? c.kycStatus === 'verified' && c.isAdult && !nearTaxThreshold && c.trustlyLinked : false;

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

      {c !== null && !c.trustlyLinked && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Link a bank account to buy tokens - Penny Pinching Trivia pays and collects directly from your bank.
            This also verifies your identity for withdrawals later.
          </Text>
          <Pressable style={styles.smallButton} onPress={linkBankAccount} disabled={busy}>
            <Text style={styles.buttonText}>Link bank account</Text>
          </Pressable>
        </View>
      )}

      {BUNDLES.map((bundle) => (
        <Pressable key={bundle.id} style={styles.bundleCard} onPress={() => buyBundle(bundle.id)} disabled={busy}>
          {(bundle.popular || bundle.bestValue) && (
            <Text style={styles.bundleFlag}>{bundle.popular ? 'Most popular' : 'Best value'}</Text>
          )}
          <Image source={bundle.art} style={styles.bundleArt} />
          <View style={styles.bundleInfo}>
            <Text style={styles.bundleName}>{bundle.name}</Text>
            <Text style={styles.bundlePrice}>{bundle.price} &rarr; {bundle.tokens}</Text>
            {bundle.bonus && <Text style={styles.bundleBonus}>{bundle.bonus}</Text>}
          </View>
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>Cash out</Text>
      {c !== null && (
        <Text style={styles.withdrawableHint}>
          Withdrawable cash: ${(c.withdrawableCents / 100).toFixed(2)}
        </Text>
      )}

      {c && c.trustlyLinked && c.kycStatus !== 'verified' && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            {c.kycStatus === 'rejected'
              ? "We couldn't verify your identity from your linked bank account. Contact support to try again."
              : "Your identity verification is being reviewed - this usually takes a few minutes."}
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
        placeholderTextColor={theme.textMuted}
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
          {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.buttonText}>Dev: +$10.00 (testing only)</Text>}
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: theme.bg },
  balanceLabel: { color: theme.textMuted, fontSize: 14, marginTop: 24, textAlign: 'center' },
  balance: { color: theme.text, fontSize: 48, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  splitRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.surface, borderRadius: 12, paddingVertical: 14, marginBottom: 8 },
  splitCell: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: theme.border },
  splitValueCash: { color: theme.emerald, fontSize: 22, fontWeight: '800' },
  splitValueBonus: { color: theme.gold, fontSize: 22, fontWeight: '800' },
  splitLabel: { color: theme.textMuted, fontSize: 12, marginTop: 4 },
  splitNote: { color: theme.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 24 },
  withdrawableHint: { color: theme.emerald, fontSize: 13, marginBottom: 12 },
  sectionTitle: { color: theme.text, fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  button: { backgroundColor: theme.surface, borderRadius: 10, paddingVertical: 14, marginBottom: 12 },
  buttonDisabled: { opacity: 0.5 },
  bundleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    marginBottom: 12,
  },
  bundleFlag: {
    position: 'absolute',
    top: -9,
    left: 14,
    backgroundColor: theme.gold,
    color: theme.bg,
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  bundleArt: { width: 52, height: 52, borderRadius: 26, marginRight: 14 },
  bundleInfo: { flex: 1 },
  bundleName: { color: theme.textMuted, fontStyle: 'italic', fontSize: 12 },
  bundlePrice: { color: theme.text, fontWeight: '800', fontSize: 16, marginTop: 2 },
  bundleBonus: { color: theme.emerald, fontWeight: '700', fontSize: 12, marginTop: 2 },
  smallButton: { backgroundColor: theme.emerald, borderRadius: 8, paddingVertical: 10, marginTop: 10 },
  devButton: { backgroundColor: theme.gold, borderRadius: 10, paddingVertical: 14, marginTop: 24 },
  buttonText: { color: theme.text, textAlign: 'center', fontWeight: '700', fontSize: 16 },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  notice: { backgroundColor: theme.gold + '22', borderRadius: 10, padding: 14, marginBottom: 12 },
  noticeText: { color: theme.gold, fontSize: 14 },
});
