import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Results'>;

const PLACE_LABEL: Record<number, string> = { 1: 'Winner', 2: '2nd Place', 3: '3rd Place' };

export default function ResultsScreen({ route, navigation }: Props) {
  const { payload } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Game Complete</Text>
      <Text style={styles.subtitle}>Prize pool: ${(payload.totalPrizePoolCents / 100).toFixed(2)}</Text>

      <FlatList
        data={payload.payouts}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={{ marginTop: 24 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.place}>{PLACE_LABEL[item.place] ?? `#${item.place}`}</Text>
            <Text style={styles.score}>{item.totalScore} pts</Text>
            <Text style={styles.amount}>${(item.amountCents / 100).toFixed(2)}</Text>
          </View>
        )}
      />

      <Pressable style={styles.button} onPress={() => navigation.replace('Lobby')}>
        <Text style={styles.buttonText}>Back to Lobby</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', textAlign: 'center', marginTop: 24 },
  subtitle: { color: '#9a9aa5', textAlign: 'center', marginTop: 8 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1c1c24',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
  },
  place: { color: '#fff', fontWeight: '700' },
  score: { color: '#9a9aa5' },
  amount: { color: '#22c55e', fontWeight: '700' },
  button: { backgroundColor: '#22c55e', borderRadius: 10, paddingVertical: 14, marginTop: 24 },
  buttonText: { color: '#0f0f14', textAlign: 'center', fontWeight: '700', fontSize: 16 },
});
