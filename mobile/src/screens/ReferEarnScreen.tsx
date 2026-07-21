import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl, ScrollView, Share, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { useAuth } from '../contexts/AuthContext';
import { theme, money } from '../theme';

type ReferralStatus = {
  referralCode: string | null;
  rewardPerReferralCents: number;
  totalReferred: number;
  rewardedCount: number;
  pendingCount: number;
  tokensEarnedCents: number;
};

export default function ReferEarnScreen() {
  const { signOut } = useAuth();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.rpc('my_referral_status');
    if (data) setStatus(data as ReferralStatus);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function shareCode() {
    if (!status?.referralCode) return;
    const message = `Join me on Penny Pinching Trivia! Use my code ${status.referralCode} and we both earn ${money(
      status.rewardPerReferralCents
    )} in tokens once you play. 🧠💸`;
    try {
      if (Platform.OS === 'web') {
        await navigator.clipboard?.writeText(message);
        showAlert('Copied!', 'Your invite message is on your clipboard - paste it anywhere.');
      } else {
        await Share.share({ message });
      }
    } catch {
      // user cancelled the share sheet - nothing to do
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 20, paddingTop: 24, paddingBottom: 40 }}
      refreshControl={<RefreshControl tintColor={theme.emerald} refreshing={refreshing} onRefresh={load} />}
    >
      <Text style={styles.heading}>🎁 Refer & Earn</Text>
      <Text style={styles.sub}>
        Share your code. When a friend signs up and plays their first round, you both get{' '}
        {status ? money(status.rewardPerReferralCents) : '$5.00'} in tokens.
      </Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>YOUR CODE</Text>
        <Text style={styles.code}>{status?.referralCode ?? '—'}</Text>
        <Pressable style={styles.shareBtn} onPress={shareCode} disabled={!status?.referralCode}>
          <Text style={styles.shareBtnText}>Share invite</Text>
        </Pressable>
      </View>

      <View style={styles.statRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{status?.totalReferred ?? 0}</Text>
          <Text style={styles.statLabel}>Friends referred</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{status?.pendingCount ?? 0}</Text>
          <Text style={styles.statLabel}>Pending first play</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: theme.gold }]}>{money(status?.tokensEarnedCents ?? 0)}</Text>
          <Text style={styles.statLabel}>Earned so far</Text>
        </View>
      </View>

      <Pressable onPress={signOut} style={styles.signOutRow}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  heading: { color: theme.text, fontSize: 26, fontWeight: '900', marginBottom: 8 },
  sub: { color: theme.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 20 },
  codeCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  codeLabel: { color: theme.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  code: { color: theme.gold, fontSize: 32, fontWeight: '900', letterSpacing: 2, marginBottom: 16 },
  shareBtn: { backgroundColor: theme.emerald, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 28 },
  shareBtnText: { color: theme.bg, fontWeight: '900', fontSize: 15 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: { color: theme.text, fontSize: 20, fontWeight: '900' },
  statLabel: { color: theme.textMuted, fontSize: 11, fontWeight: '700', marginTop: 4, textAlign: 'center' },
  signOutRow: { alignItems: 'center', marginTop: 12 },
  signOutText: { color: theme.textMuted, fontSize: 13, fontWeight: '600' },
});
