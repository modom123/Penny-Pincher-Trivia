import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { theme, money } from '../theme';

type Row = { user_id: string; username: string; lifetime_winnings_cents: number };

const MEDAL = ['🥇', '🥈', '🥉'];

export default function LeaderboardScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const { data } = await supabase.rpc('list_top_winners', { p_limit: 50 });
    if (data) setRows(data as Row[]);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Top Winners</Text>
      <Text style={styles.sub}>All-time cash winnings across every game</Text>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.user_id}
        refreshControl={<RefreshControl tintColor={theme.emerald} refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={<Text style={styles.empty}>No payouts yet — be the first on the board.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.row}>
            <Text style={styles.rank}>{MEDAL[index] ?? `${index + 1}`}</Text>
            <Text style={styles.username} numberOfLines={1}>
              {item.username}
            </Text>
            <Text style={styles.amount}>{money(item.lifetime_winnings_cents)}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 24, backgroundColor: theme.bg },
  heading: { color: theme.text, fontSize: 26, fontWeight: '900' },
  sub: { color: theme.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },
  empty: { color: theme.textMuted, textAlign: 'center', marginTop: 48 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  rank: { width: 36, color: theme.gold, fontWeight: '900', fontSize: 16 },
  username: { flex: 1, color: theme.text, fontWeight: '700', fontSize: 15, marginRight: 8 },
  amount: { color: theme.emerald, fontWeight: '900', fontSize: 16 },
});
