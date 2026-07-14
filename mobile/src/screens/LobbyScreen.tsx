import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { theme, money } from '../theme';
import RegionGate from '../components/RegionGate';
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
  milestone_booster: { label: 'Milestone Booster', tag: 'Pool pays the leader at 25/50/75' },
};

type HistoryGame = {
  game_id: string;
  mode: GameMode;
  status: string;
  payout_cents: number;
  milestone_bonus_cents: number;
  spent_cents: number;
  total_score: number;
  current_round_reached: number;
  is_eliminated: boolean;
};

type PlayerStats = {
  gamesPlayed: number;
  gamesWon: number;
  lifetimeWinningsCents: number;
  lifetimeSpentCents: number;
};

export default function LobbyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<HistoryGame[]>([]);
  const [stats, setStats] = useState<PlayerStats | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: gameData }, { data: comp }, { data: hist }, { data: playerStats }] = await Promise.all([
      supabase
        .from('games')
        .select(
          'game_id, status, mode, current_round, total_rounds, total_prize_pool_cents, in_sudden_death, subjects(name, domain)'
        )
        .in('status', ['pending', 'active'])
        .order('created_at', { ascending: false }),
      supabase.rpc('my_compliance_status'),
      supabase.rpc('my_game_history', { p_limit: 10 }),
      supabase.rpc('my_player_stats'),
    ]);
    if (gameData) setGames(gameData as unknown as Game[]);
    if (comp && typeof comp.walletBalanceCents === 'number') setBalanceCents(comp.walletBalanceCents);
    if (hist) setHistory(hist as HistoryGame[]);
    if (playerStats) setStats(playerStats as PlayerStats);
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
      <Text style={styles.subheading}>Prizes scale with the field — up to the top 10% cash.</Text>

      <RegionGate />

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
        ListFooterComponent={
          <View style={styles.historySection}>
            {stats && stats.gamesPlayed > 0 && (
              <View style={styles.statsRow}>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.gamesPlayed}</Text>
                  <Text style={styles.statLabel}>Played</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={styles.statValue}>{stats.gamesWon}</Text>
                  <Text style={styles.statLabel}>Won</Text>
                </View>
                <View style={styles.statCell}>
                  <Text style={[styles.statValue, { color: theme.gold }]}>{money(stats.lifetimeWinningsCents)}</Text>
                  <Text style={styles.statLabel}>Lifetime winnings</Text>
                </View>
              </View>
            )}
            {history.length > 0 && (
              <>
                <Text style={styles.historyHeading}>Your recent games</Text>
                {history.map((h) => {
                  const meta = MODE_META[h.mode];
                  const netCents = h.payout_cents + h.milestone_bonus_cents - h.spent_cents;
                  const inProgress = h.status !== 'completed';
                  return (
                    <Pressable
                      key={h.game_id}
                      style={styles.historyCard}
                      onPress={() => !inProgress || navigation.navigate('Game', { gameId: h.game_id })}
                    >
                      <View>
                        <Text style={styles.historyMode}>{meta.label}</Text>
                        <Text style={styles.historyStatus}>
                          {inProgress ? `In progress — round ${h.current_round_reached}` : h.is_eliminated ? 'Eliminated' : 'Finished'}
                        </Text>
                      </View>
                      <Text style={[styles.historyNet, netCents >= 0 ? styles.historyNetPositive : styles.historyNetNegative]}>
                        {inProgress ? '—' : `${netCents >= 0 ? '+' : ''}${money(netCents)}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </>
            )}
          </View>
        }
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

  heading: { color: theme.text, fontSize: 26, fontWeight: '900', marginBottom: 4 },
  subheading: { color: theme.textMuted, fontSize: 13, marginBottom: 14 },
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

  historySection: { marginTop: 8 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 14,
    marginBottom: 18,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statValue: { color: theme.text, fontSize: 18, fontWeight: '900' },
  statLabel: { color: theme.textMuted, fontSize: 11, marginTop: 2 },
  historyHeading: { color: theme.text, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  historyCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  historyMode: { color: theme.text, fontSize: 14, fontWeight: '700' },
  historyStatus: { color: theme.textMuted, fontSize: 12, marginTop: 2 },
  historyNet: { fontSize: 15, fontWeight: '800' },
  historyNetPositive: { color: theme.emerald },
  historyNetNegative: { color: theme.crimson },
});
