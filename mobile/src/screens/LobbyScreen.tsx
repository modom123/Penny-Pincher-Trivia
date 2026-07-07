import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { theme, money } from '../theme';
import type { RootStackParamList } from '../types';

type GameMode = 'original_escalator' | 'streak_saver' | 'milestone_booster';

type Game = {
  game_id: string;
  status: string;
  mode: GameMode;
  current_round: number;
  total_rounds: number;
  total_prize_pool_cents: number;
  in_sudden_death: boolean;
  subjects: { name: string; domain: string } | null;
};

const MODE_META: Record<GameMode, { label: string; tag: string }> = {
  original_escalator: { label: 'The Escalator', tag: 'Round N costs N¢' },
  streak_saver: { label: 'Streak Saver', tag: 'Play free with a streak' },
  milestone_booster: { label: 'Milestone Booster', tag: 'Pot boosts at 25/50/75' },
};

export default function LobbyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: gameData }, { data: comp }] = await Promise.all([
      supabase
        .from('games')
        .select(
          'game_id, status, mode, current_round, total_rounds, total_prize_pool_cents, in_sudden_death, subjects(name, domain)'
        )
        .in('status', ['pending', 'active'])
        .order('created_at', { ascending: false }),
      supabase.rpc('my_compliance_status'),
    ]);
    if (gameData) setGames(gameData as unknown as Game[]);
    if (comp && typeof comp.walletBalanceCents === 'number') setBalanceCents(comp.walletBalanceCents);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      {/* Top bar: avatar, unified Penny Wallet balance + quick deposit */}
      <View style={styles.topBar}>
        <View style={styles.avatar} />
        <Pressable style={styles.walletPill} onPress={() => navigation.navigate('Wallet')}>
          <Text style={styles.walletBalance}>{balanceCents == null ? '—' : money(balanceCents)}</Text>
          <View style={styles.plus}>
            <Text style={styles.plusText}>+</Text>
          </View>
        </Pressable>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>Play Now</Text>

      <FlatList
        data={games}
        keyExtractor={(item) => item.game_id}
        refreshControl={<RefreshControl tintColor={theme.emerald} refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={<Text style={styles.empty}>No live games right now. Pull to refresh.</Text>}
        renderItem={({ item }) => {
          const meta = MODE_META[item.mode];
          return (
            <Pressable style={styles.card} onPress={() => navigation.navigate('Game', { gameId: item.game_id })}>
              <View style={styles.cardTop}>
                <Text style={styles.cardMode}>{meta.label}</Text>
                {item.subjects?.name ? <Text style={styles.subjectBadge}>{item.subjects.name}</Text> : null}
              </View>
              <Text style={styles.cardTag}>{meta.tag}</Text>

              <View style={styles.poolRow}>
                <View>
                  <Text style={styles.poolLabel}>PRIZE POOL</Text>
                  <Text style={styles.poolValue}>{money(item.total_prize_pool_cents)}</Text>
                </View>
                <View style={styles.roundBox}>
                  <Text style={styles.roundText}>
                    {item.status === 'pending' ? 'Starting soon' : `Round ${item.current_round}/${item.total_rounds}`}
                  </Text>
                </View>
              </View>

              {item.in_sudden_death && <Text style={styles.suddenDeath}>⚡ SUDDEN DEATH OVERTIME</Text>}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 56, backgroundColor: theme.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.surfaceAlt, marginRight: 12 },
  walletPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
  },
  walletBalance: { color: theme.gold, fontSize: 18, fontWeight: '900' },
  plus: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.emerald, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: theme.bg, fontSize: 22, fontWeight: '900', marginTop: -2 },
  signOut: { color: theme.textMuted, marginLeft: 14, fontSize: 13 },

  heading: { color: theme.text, fontSize: 26, fontWeight: '900', marginBottom: 14 },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 48 },

  card: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardMode: { color: theme.emerald, fontSize: 17, fontWeight: '800' },
  subjectBadge: {
    color: theme.gold,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: theme.gold + '1A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  cardTag: { color: theme.textMuted, fontSize: 13, marginTop: 3 },

  poolRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 },
  poolLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  poolValue: { color: theme.gold, fontSize: 26, fontWeight: '900', marginTop: 2 },
  roundBox: { backgroundColor: theme.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  roundText: { color: theme.text, fontWeight: '700', fontSize: 13 },
  suddenDeath: { color: theme.crimson, fontWeight: '800', fontSize: 12, marginTop: 12, letterSpacing: 1 },
});
