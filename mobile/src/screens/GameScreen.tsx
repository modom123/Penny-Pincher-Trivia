import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import type { RootStackParamList, RoundStartPayload, RoundEndPayload, GameCompletedPayload } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

type Phase = 'waiting' | 'open' | 'answered' | 'closed';
type OptionKey = 'A' | 'B' | 'C' | 'D';
const TOTAL_ROUNDS = 100;

// Haptics are a no-op / unsupported on web - never let them break the tap handler.
function pop(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium) {
  Haptics.impactAsync(style).catch(() => {});
}
function notify(type: Haptics.NotificationFeedbackType) {
  Haptics.notificationAsync(type).catch(() => {});
}

export default function GameScreen({ route, navigation }: Props) {
  const { gameId } = route.params;
  const [round, setRound] = useState<RoundStartPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [purchased, setPurchased] = useState(false);
  const [fraction, setFraction] = useState(1); // 1 -> 0 over the round timer
  const [prizePoolCents, setPrizePoolCents] = useState(0);
  const [results, setResults] = useState<Record<number, 'correct' | 'incorrect'>>({});
  const [selected, setSelected] = useState<OptionKey | null>(null);
  const [correct, setCorrect] = useState(false);
  const [revealedCorrect, setRevealedCorrect] = useState<string | null>(null);
  const [streakFree, setStreakFree] = useState(false);
  const [regionBlocked, setRegionBlocked] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef<ScrollView | null>(null);

  // Geo-fence: verify device location once when the arena opens (server enforces
  // the hard block in buy_round regardless).
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('geo-check', {
          body: { state: undefined, radarToken: undefined },
        });
        if (!error && data?.regionBlocked) setRegionBlocked(true);
      } catch {
        // Non-fatal here.
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
        setSelected(null);
        setRevealedCorrect(null);
        if (typeof p.totalPrizePoolCents === 'number') setPrizePoolCents(p.totalPrizePoolCents);
        startCountdown(p);
      })
      .on('broadcast', { event: 'round:end' }, ({ payload }) => {
        const p = payload as RoundEndPayload;
        setRevealedCorrect(p.correctOption);
        setPhase('closed');
        if (typeof p.totalPrizePoolCents === 'number') setPrizePoolCents(p.totalPrizePoolCents);
        if (tickRef.current) clearInterval(tickRef.current);
        setFraction(0);
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

  // Auto-scroll the 1-100 tracker to keep the active round in view.
  useEffect(() => {
    if (round) {
      const x = Math.max((round.roundNumber - 4) * 34, 0);
      trackRef.current?.scrollTo({ x, animated: true });
    }
  }, [round?.roundNumber]);

  function startCountdown(p: RoundStartPayload) {
    if (tickRef.current) clearInterval(tickRef.current);
    const total = p.timeLimitSeconds * 1000;
    const deadline = p.serverStartTimeMs + total;
    tickRef.current = setInterval(() => {
      const remainingMs = deadline - Date.now();
      setFraction(Math.max(remainingMs / total, 0));
      if (remainingMs <= 0 && tickRef.current) clearInterval(tickRef.current);
    }, 100);
  }

  async function buyRound() {
    if (!round) return;
    pop(Haptics.ImpactFeedbackStyle.Heavy);
    const { data, error } = await supabase.rpc('buy_round', { p_game_id: gameId, p_round_number: round.roundNumber });
    if (error) {
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
    if (data?.gameOver) {
      Alert.alert('Game over', data.message, [{ text: 'OK', onPress: () => navigation.replace('Lobby') }]);
      return;
    }
    setStreakFree(Boolean(data?.streakFree));
    if (typeof data?.gamePoolState?.totalPrizePoolCents === 'number') {
      setPrizePoolCents(data.gamePoolState.totalPrizePoolCents);
    }
    setPurchased(true);
  }

  async function answer(option: OptionKey) {
    if (!round || selected) return;
    setSelected(option);
    const { data, error } = await supabase.rpc('submit_answer', {
      p_game_id: gameId,
      p_round_number: round.roundNumber,
      p_selected_option: option,
    });
    if (error) {
      setSelected(null);
      Alert.alert("Couldn't submit answer", error.message);
      return;
    }
    setCorrect(Boolean(data.isCorrect));
    setResults((prev) => ({ ...prev, [round.roundNumber]: data.isCorrect ? 'correct' : 'incorrect' }));
    notify(data.isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
    setPhase('answered');
  }

  function optionStyle(key: OptionKey) {
    // After the player has locked an answer, recolor: their pick emerald/crimson,
    // and once the round closes, always show the correct option emerald.
    if (revealedCorrect === key) return [styles.optionButton, styles.optionCorrect];
    if (selected === key) return [styles.optionButton, correct ? styles.optionCorrect : styles.optionWrong];
    return [styles.optionButton];
  }

  if (!round) {
    return (
      <View style={styles.container}>
        <View style={styles.poolBar}>
          <Text style={styles.poolLabel}>LIVE PRIZE POOL</Text>
          <Text style={styles.poolValue}>${(prizePoolCents / 100).toFixed(2)}</Text>
        </View>
        <Text style={styles.waiting}>Waiting for the next round to start…</Text>
      </View>
    );
  }

  const locked = selected !== null || phase !== 'open';

  return (
    <View style={styles.container}>
      {/* Sticky live prize pool */}
      <View style={styles.poolBar}>
        <Text style={styles.poolLabel}>LIVE PRIZE POOL</Text>
        <Text style={styles.poolValue}>${(prizePoolCents / 100).toFixed(2)}</Text>
      </View>

      {/* Rounds 1-100 progress tracker */}
      <ScrollView
        ref={trackRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.track}
        contentContainerStyle={styles.trackContent}
      >
        {Array.from({ length: TOTAL_ROUNDS }, (_, i) => i + 1).map((r) => {
          const res = results[r];
          const isActive = r === round.roundNumber && !round.isOvertime;
          const isLocked = r > round.roundNumber;
          return (
            <View
              key={r}
              style={[
                styles.pip,
                res === 'correct' && styles.pipCorrect,
                res === 'incorrect' && styles.pipWrong,
                isActive && styles.pipActive,
                isLocked && styles.pipLocked,
              ]}
            >
              <Text style={[styles.pipText, isLocked && styles.pipTextLocked]}>{isLocked ? '🔒' : r}</Text>
            </View>
          );
        })}
      </ScrollView>

      {round.isOvertime && <Text style={styles.overtimeBanner}>⚡ SUDDEN DEATH OVERTIME</Text>}

      {/* Question card */}
      <View style={styles.card}>
        <Text style={styles.roundLabel}>
          Round {round.roundNumber}
          {!round.isOvertime && ` / ${TOTAL_ROUNDS}`}
        </Text>
        <Text style={styles.question}>{round.questionText}</Text>
        {/* Shrinking countdown bar */}
        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              { width: `${Math.round(fraction * 100)}%` },
              fraction < 0.25 && styles.timerFillLow,
            ]}
          />
        </View>
      </View>

      {!purchased && phase === 'open' && regionBlocked && (
        <View style={styles.blockedBox}>
          <Text style={styles.blockedText}>
            Penny Pincher cash games are currently unavailable in your region. You can still play our free daily practice
            tracks!
          </Text>
        </View>
      )}

      {/* Micro-debit toll button */}
      {!purchased && phase === 'open' && !regionBlocked && (
        <Pressable style={styles.buyButton} onPress={buyRound}>
          <Text style={styles.buyButtonText}>
            Unlock Round {round.roundNumber} · ${(round.costCents / 100).toFixed(2)}
          </Text>
        </Pressable>
      )}

      {purchased && streakFree && phase === 'open' && <Text style={styles.streakBadge}>FREE — streak bonus! 🔥</Text>}

      {/* Answer array */}
      {purchased && (phase === 'open' || phase === 'answered' || phase === 'closed') && (
        <View style={styles.options}>
          {(Object.entries(round.options) as [OptionKey, string][]).map(([key, label]) => (
            <Pressable key={key} style={optionStyle(key)} onPress={() => answer(key)} disabled={locked}>
              <Text style={styles.optionKey}>{key}</Text>
              <Text style={styles.optionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {phase === 'answered' && <Text style={styles.waiting}>Answer locked in — waiting for the round to close…</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#0b0f1a' },
  waiting: { color: '#8a93a6', fontSize: 15, textAlign: 'center', marginTop: 32 },

  poolBar: {
    backgroundColor: '#0f1626',
    borderColor: '#1c2740',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  poolLabel: { color: '#f5c542', fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  poolValue: { color: '#22c55e', fontSize: 34, fontWeight: '900', marginTop: 2 },

  track: { maxHeight: 40, marginBottom: 12 },
  trackContent: { alignItems: 'center', paddingRight: 12 },
  pip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 6,
    backgroundColor: '#1c2740',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipText: { color: '#8a93a6', fontSize: 10, fontWeight: '700' },
  pipTextLocked: { fontSize: 9 },
  pipCorrect: { backgroundColor: '#22c55e' },
  pipWrong: { backgroundColor: '#ef4444' },
  pipActive: { borderWidth: 2, borderColor: '#f5c542', backgroundColor: '#2a3550' },
  pipLocked: { backgroundColor: '#141b2b' },

  overtimeBanner: { color: '#ef4444', fontSize: 14, fontWeight: '800', letterSpacing: 1, marginBottom: 8, textAlign: 'center' },

  card: { backgroundColor: '#0f1626', borderColor: '#1c2740', borderWidth: 1, borderRadius: 16, padding: 20, marginBottom: 16 },
  roundLabel: { color: '#8a93a6', fontSize: 13, marginBottom: 8 },
  question: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 18, lineHeight: 28 },
  timerTrack: { height: 8, borderRadius: 4, backgroundColor: '#1c2740', overflow: 'hidden' },
  timerFill: { height: 8, borderRadius: 4, backgroundColor: '#22c55e' },
  timerFillLow: { backgroundColor: '#ef4444' },

  blockedBox: { backgroundColor: '#ef444422', borderRadius: 12, padding: 16 },
  blockedText: { color: '#ef4444', fontSize: 15 },

  streakBadge: { color: '#22c55e', fontWeight: '800', marginBottom: 12, textAlign: 'center' },

  buyButton: { backgroundColor: '#22c55e', borderRadius: 14, paddingVertical: 18, shadowColor: '#22c55e', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  buyButtonText: { color: '#04120a', textAlign: 'center', fontWeight: '900', fontSize: 17 },

  options: { gap: 12, marginTop: 4 },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#141b2b',
    borderColor: '#1c2740',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  optionCorrect: { backgroundColor: '#0f3d24', borderColor: '#22c55e' },
  optionWrong: { backgroundColor: '#3d1414', borderColor: '#ef4444' },
  optionKey: {
    color: '#f5c542',
    fontWeight: '900',
    fontSize: 15,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1c2740',
    textAlign: 'center',
    lineHeight: 26,
    marginRight: 14,
    overflow: 'hidden',
  },
  optionText: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
});
