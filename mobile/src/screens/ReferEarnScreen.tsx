import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { inviteViaEmail, inviteViaSms, inviteViaMore, copyReferralLink, referralLink } from '../lib/referral';
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

  function invite(via: 'email' | 'sms' | 'more') {
    if (!status?.referralCode) return;
    const args: [string, number] = [status.referralCode, status.rewardPerReferralCents];
    if (via === 'email') inviteViaEmail(...args);
    else if (via === 'sms') inviteViaSms(...args);
    else inviteViaMore(...args);
  }

  function copyLink() {
    if (!status?.referralCode) return;
    copyReferralLink(status.referralCode);
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
        {status?.referralCode && (
          <Pressable onPress={copyLink} style={styles.linkRow}>
            <Text style={styles.linkText} numberOfLines={1}>{referralLink(status.referralCode)}</Text>
            <Text style={styles.linkCopy}>Copy</Text>
          </Pressable>
        )}
        <View style={styles.inviteBtnRow}>
          <Pressable style={styles.inviteBtn} onPress={() => invite('email')} disabled={!status?.referralCode}>
            <Text style={styles.inviteBtnText}>📧 Email</Text>
          </Pressable>
          <Pressable style={styles.inviteBtn} onPress={() => invite('sms')} disabled={!status?.referralCode}>
            <Text style={styles.inviteBtnText}>💬 Text</Text>
          </Pressable>
          <Pressable style={styles.inviteBtn} onPress={() => invite('more')} disabled={!status?.referralCode}>
            <Text style={styles.inviteBtnText}>↗️ More</Text>
          </Pressable>
        </View>
        <Text style={styles.linkHint}>
          Tip: paste the bare link above into a bio, story, or DM - a wall of text with a
          link buried in it often gets ignored, but a clean link stands out and can even
          generate a link preview.
        </Text>
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
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.bgDeep,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    width: '100%',
    marginBottom: 16,
  },
  linkText: { flex: 1, color: theme.text, fontSize: 13, fontWeight: '600' },
  linkCopy: { color: theme.emerald, fontSize: 13, fontWeight: '900' },
  linkHint: { color: theme.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12, textAlign: 'center' },
  inviteBtnRow: { flexDirection: 'row', gap: 8, width: '100%' },
  inviteBtn: {
    flex: 1,
    backgroundColor: theme.emerald,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  inviteBtnText: { color: theme.bg, fontWeight: '900', fontSize: 13 },
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
