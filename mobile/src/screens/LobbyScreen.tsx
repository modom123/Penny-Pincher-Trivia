import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
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
};

const MODE_LABELS: Record<GameMode, string> = {
  original_escalator: 'Flat-Rate Escalator',
  streak_saver: 'Streak Saver',
  milestone_booster: 'Milestone Booster',
};

export default function LobbyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadGames = useCallback(async () => {
    setRefreshing(true);
    const { data, error } = await supabase
      .from('games')
      .select('game_id, status, mode, current_round, total_rounds, total_prize_pool_cents, in_sudden_death')
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false });
    if (!error && data) setGames(data);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGames();
    }, [loadGames])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Games</Text>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <Pressable style={styles.walletLink} onPress={() => navigation.navigate('Wallet')}>
        <Text style={styles.walletLinkText}>Wallet</Text>
      </Pressable>

      <RegionGate />

      <FlatList
        data={games}
        keyExtractor={(item) => item.game_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadGames} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={<Text style={styles.empty}>No games running right now.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => navigation.navigate('Game', { gameId: item.game_id })}>
            <Text style={styles.cardMode}>{MODE_LABELS[item.mode]}</Text>
            <Text style={styles.cardTitle}>Round {item.current_round} / {item.total_rounds}</Text>
            <Text style={styles.cardSubtitle}>Prize pool: ${(item.total_prize_pool_cents / 100).toFixed(2)}</Text>
            <Text style={styles.cardStatus}>{item.in_sudden_death ? 'SUDDEN DEATH OVERTIME' : item.status.toUpperCase()}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  signOut: { color: '#9a9aa5' },
  walletLink: { alignSelf: 'flex-start', marginBottom: 16 },
  walletLinkText: { color: '#22c55e', fontWeight: '700' },
  empty: { color: '#9a9aa5', textAlign: 'center', marginTop: 48 },
  card: { backgroundColor: '#1c1c24', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardMode: { color: '#22c55e', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  cardSubtitle: { color: '#9a9aa5', marginTop: 4 },
  cardStatus: { color: '#22c55e', marginTop: 8, fontWeight: '700', fontSize: 12 },
});
