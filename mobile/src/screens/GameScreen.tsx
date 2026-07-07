import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { RootStackParamList, RoundStartPayload, RoundEndPayload, GameCompletedPayload } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

type Phase = 'waiting' | 'open' | 'answered' | 'closed';

export default function GameScreen({ route, navigation }: Props) {
  const { gameId } = route.params;
  const [round, setRound] = useState<RoundStartPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [purchased, setPurchased] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lastResult, setLastResult] = useState<RoundEndPayload | null>(null);
  const [streakFree, setStreakFree] = useState(false);
  const [regionBlocked, setRegionBlocked] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Geo-fence: verify the device location once when the game card opens, so the
  // server has a fresh region on record before any buy-in. In production the
  // `state` comes from the Radar.io/GeoComply SDK; here we send the device's
  // best guess and let the server decide. The real enforcement is in buy_round.
  useEffect(() => {
    (async () => {
      try {
        // TODO: replace with the geo-vendor SDK's verified region + signed token.
        const { data, error } = await supabase.functions.invoke('geo-check', {
          body: { state: undefined, radarToken: undefined },
        });
        if (!error && data?.regionBlocked) setRegionBlocked(true);
      } catch {
        // Non-fatal here; buy_round enforces the hard block regardless.
      }
    })();
  }, [gameId]);

  useEffect(() => {
    const channel = supabase.channel(`game:${gameId}`);

    channel
      .on('broadcast', { event: 'round:start' }, ({ payload }) => {
        const p = payload as RoundStartPayload;
        setRound(p);
        setPurchased(false);
        setPhase('open');
        setLastResult(null);
        startCountdown(p);
      })
      .on('broadcast', { event: 'round:end' }, ({ payload }) => {
        setLastResult(payload as RoundEndPayload);
        setPhase('closed');
        if (tickRef.current) clearInterval(tickRef.current);
      })
      .on('broadcast', { event: 'game:completed' }, ({ payload }) => {
        navigation.replace('Results', { payload: payload as GameCompletedPayload });
      })
      .on('broadcast', { event: 'game:error' }, ({ payload }) => {
        Alert.alert('Game error', (payload as { error: string }).error);
      })
      .subscribe();

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  function startCountdown(p: RoundStartPayload) {
    if (tickRef.current) clearInterval(tickRef.current);
    const deadline = p.serverStartTimeMs + p.timeLimitSeconds * 1000;
    tickRef.current = setInterval(() => {
      const remainingMs = deadline - Date.now();
      setSecondsLeft(Math.max(Math.ceil(remainingMs / 1000), 0));
      if (remainingMs <= 0 && tickRef.current) {
        clearInterval(tickRef.current);
      }
    }, 200);
  }

  async function buyRound() {
    if (!round) return;
    const { data, error } = await supabase.rpc('buy_round', { p_game_id: gameId, p_round_number: round.roundNumber });
    if (error) {
      // Needing to top up (rounds 1-30) surfaces as a TOP_UP_REQUIRED error -
      // send the player to the wallet to add funds, then they can retry the round.
      if (error.message.includes('TOP_UP_REQUIRED')) {
        Alert.alert('Top up to continue', "You don't have enough tokens for this round. Add funds to keep playing.", [
          { text: 'Not now', style: 'cancel' },
          { text: 'Go to Wallet', onPress: () => navigation.navigate('Wallet') },
        ]);
      } else {
        Alert.alert("Couldn't buy round", error.message.replace(/^[A-Z_]+:\s*/, ''));
      }
      return;
    }
    // Round 31+ with insufficient funds returns gameOver instead of an error.
    if (data?.gameOver) {
      Alert.alert('Game over', data.message, [{ text: 'OK', onPress: () => navigation.replace('Lobby') }]);
      return;
    }
    setStreakFree(Boolean(data?.streakFree));
    setPurchased(true);
  }

  async function answer(option: 'A' | 'B' | 'C' | 'D') {
    if (!round) return;
    const { data, error } = await supabase.rpc('submit_answer', {
      p_game_id: gameId,
      p_round_number: round.roundNumber,
      p_selected_option: option,
    });
    if (error) {
      Alert.alert("Couldn't submit answer", error.message);
      return;
    }
    setPhase('answered');
    const delta = data.pointsAwarded >= 0 ? `+${data.pointsAwarded}` : `${data.pointsAwarded}`;
    Alert.alert(
      data.isCorrect ? 'Correct!' : 'Incorrect',
      `${delta} points  ·  Total: ${data.newTotalScore}`
    );
  }

  if (!round) {
    return (
      <View style={styles.container}>
        <Text style={styles.waiting}>Waiting for the next round to start...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {round.isOvertime && <Text style={styles.overtimeBanner}>SUDDEN DEATH OVERTIME</Text>}
      <Text style={styles.roundLabel}>Round {round.roundNumber}{!round.isOvertime && ' / 100'}</Text>
      <Text style={styles.timer}>{secondsLeft}s</Text>
      <Text style={styles.question}>{round.questionText}</Text>

      {!purchased && phase === 'open' && regionBlocked && (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedText}>
            Penny Pincher cash games are currently unavailable in your region. You can still play our free daily practice
            tracks!
          </Text>
        </View>
      )}

      {!purchased && phase === 'open' && !regionBlocked && (
        <Pressable style={styles.buyButton} onPress={buyRound}>
          <Text style={styles.buyButtonText}>Buy this round - {round.costCents}c</Text>
        </Pressable>
      )}

      {purchased && streakFree && phase === 'open' && <Text style={styles.streakBadge}>FREE - streak bonus!</Text>}

      {purchased && phase === 'open' && (
        <View style={styles.options}>
          {(Object.entries(round.options) as [string, string][]).map(([key, label]) => (
            <Pressable key={key} style={styles.optionButton} onPress={() => answer(key as 'A' | 'B' | 'C' | 'D')}>
              <Text style={styles.optionText}>
                {key}. {label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {phase === 'answered' && <Text style={styles.waiting}>Answer locked in - waiting for round to end...</Text>}

      {lastResult && (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>Correct answer: {lastResult.correctOption}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#0f0f14' },
  waiting: { color: '#9a9aa5', fontSize: 16, textAlign: 'center', marginTop: 48 },
  overtimeBanner: { color: '#ef4444', fontSize: 14, fontWeight: '800', marginTop: 24, letterSpacing: 1 },
  blockedBox: { backgroundColor: '#ef444422', borderRadius: 10, padding: 16 },
  blockedText: { color: '#ef4444', fontSize: 15 },
  roundLabel: { color: '#9a9aa5', fontSize: 14, marginTop: 8 },
  streakBadge: { color: '#22c55e', fontWeight: '700', marginBottom: 12 },
  timer: { color: '#22c55e', fontSize: 40, fontWeight: '800', marginBottom: 16 },
  question: { color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 24 },
  buyButton: { backgroundColor: '#22c55e', borderRadius: 10, paddingVertical: 16 },
  buyButtonText: { color: '#0f0f14', textAlign: 'center', fontWeight: '800', fontSize: 16 },
  options: { gap: 12 },
  optionButton: { backgroundColor: '#1c1c24', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 12 },
  optionText: { color: '#fff', fontSize: 16 },
  resultBox: { marginTop: 24, padding: 16, backgroundColor: '#1c1c24', borderRadius: 10 },
  resultText: { color: '#fff', fontSize: 16, textAlign: 'center' },
});
