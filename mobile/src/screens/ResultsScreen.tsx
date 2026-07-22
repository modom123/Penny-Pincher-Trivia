import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { theme, money } from '../theme';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Results'>;

const PODIUM = {
  1: { color: theme.gold, label: '1st', height: 128, emoji: '👑' },
  2: { color: '#C7CCD6', label: '2nd', height: 96, emoji: '🥈' },
  3: { color: '#CD7F32', label: '3rd', height: 76, emoji: '🥉' },
} as const;

const nameOf = (p: { username?: string; userId: string }) => p.username ?? `Player ${p.userId.slice(0, 4)}`;

// The "Climax": final leaderboard. Top 3 rendered on a podium (gold/silver/bronze),
// then the full payout list below.
export default function ResultsScreen({ route, navigation }: Props) {
  const { payload } = route.params;
  const top3 = payload.payouts.filter((p) => p.place <= 3);
  const byPlace = (n: 1 | 2 | 3) => top3.find((p) => p.place === n);
  // Podium display order: 2nd, 1st, 3rd (classic center-stage winner).
  const order: (1 | 2 | 3)[] = [2, 1, 3];

  if (payload.noWinner) {
    return (
      <View style={styles.container}>
        <Text style={styles.kicker}>GAME COMPLETE</Text>
        <Text style={styles.pool}>{money(payload.totalPrizePoolCents)}</Text>
        <Text style={styles.poolLabel}>prize pool - no eligible winner this time</Text>

        <View style={styles.rolloverBox}>
          <Text style={styles.rolloverEmoji}>🔄</Text>
          <Text style={styles.rolloverTitle}>Pool rolled over!</Text>
          <Text style={styles.rolloverBody}>
            {payload.rolloverGameId
              ? `Nobody was left to win this one, so the ${money(payload.totalPrizePoolCents)} pool carried over into a new tournament with the same rules - head to the Lobby to sign up.`
              : `Nobody was left to win this one. Our team will roll the ${money(payload.totalPrizePoolCents)} pool into a new tournament shortly.`}
          </Text>
        </View>

        <Pressable style={styles.button} onPress={() => navigation.replace('Main', { screen: 'Home' })}>
          <Text style={styles.buttonText}>Back to Lobby</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.kicker}>GAME COMPLETE</Text>
      <Text style={styles.pool}>{money(payload.totalPrizePoolCents)}</Text>
      <Text style={styles.poolLabel}>total prize pool paid out</Text>

      <View style={styles.podium}>
        {order.map((place) => {
          const p = byPlace(place);
          const meta = PODIUM[place];
          if (!p) return <View key={place} style={styles.podiumSlot} />;
          return (
            <View key={place} style={styles.podiumSlot}>
              <Text style={styles.podiumEmoji}>{meta.emoji}</Text>
              <View style={[styles.avatar, { borderColor: meta.color }]} />
              <Text style={styles.podiumName} numberOfLines={1}>{nameOf(p)}</Text>
              <Text style={[styles.podiumPrize, { color: meta.color }]}>{money(p.amountCents)}</Text>
              <View
                style={[
                  styles.pillar,
                  { height: meta.height, backgroundColor: meta.color + '22', borderColor: meta.color },
                ]}
              >
                <Text style={[styles.pillarPlace, { color: meta.color }]}>{meta.label}</Text>
                <Text style={styles.pillarScore}>{p.totalScore} pts</Text>
              </View>
            </View>
          );
        })}
      </View>

      <FlatList
        data={payload.payouts}
        keyExtractor={(item) => item.userId}
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 12 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.rowPlace}>#{item.place}</Text>
            <Text style={styles.rowName}>{nameOf(item)}</Text>
            <Text style={styles.rowScore}>{item.totalScore} pts</Text>
            <Text style={styles.rowAmount}>{money(item.amountCents)}</Text>
          </View>
        )}
      />

      <Pressable style={styles.button} onPress={() => navigation.replace('Main', { screen: 'Home' })}>
        <Text style={styles.buttonText}>Back to Lobby</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 48, backgroundColor: theme.bg },
  kicker: { color: theme.emerald, textAlign: 'center', fontWeight: '800', letterSpacing: 3, fontSize: 12 },
  pool: { color: theme.gold, textAlign: 'center', fontSize: 44, fontWeight: '900', marginTop: 4 },
  poolLabel: { color: theme.textMuted, textAlign: 'center', fontSize: 12, marginBottom: 8 },

  rolloverBox: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.gold,
    padding: 20,
    marginTop: 20,
    alignItems: 'center',
  },
  rolloverEmoji: { fontSize: 32, marginBottom: 8 },
  rolloverTitle: { color: theme.gold, fontSize: 18, fontWeight: '900', marginBottom: 8 },
  rolloverBody: { color: theme.text, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  podium: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 10, marginTop: 12, marginBottom: 8 },
  podiumSlot: { flex: 1, alignItems: 'center' },
  podiumEmoji: { fontSize: 22 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: theme.surfaceAlt, borderWidth: 2, marginVertical: 4 },
  podiumName: { color: theme.text, fontSize: 12, fontWeight: '700', maxWidth: 90 },
  podiumPrize: { fontSize: 15, fontWeight: '900', marginBottom: 6 },
  pillar: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  pillarPlace: { fontWeight: '900', fontSize: 18 },
  pillarScore: { color: theme.textMuted, fontSize: 11, marginTop: 2 },

  list: { marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowPlace: { color: theme.textMuted, fontWeight: '800', width: 40 },
  rowName: { color: theme.text, fontWeight: '700', flex: 1 },
  rowScore: { color: theme.textMuted, marginRight: 12 },
  rowAmount: { color: theme.emerald, fontWeight: '800' },

  button: { backgroundColor: theme.emerald, borderRadius: 14, paddingVertical: 16, marginTop: 8 },
  buttonText: { color: theme.bg, textAlign: 'center', fontWeight: '900', fontSize: 16 },
});
