import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert, Animated, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { supabase } from '../lib/supabase';
import { theme, money } from '../theme';
import ChatPanel from '../components/ChatPanel';
import type { RootStackParamList, RoundStartPayload, RoundEndPayload, GameCompletedPayload } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Game'>;

type Phase = 'waiting' | 'open' | 'answered' | 'closed';
type Option = 'A' | 'B' | 'C' | 'D';

// The "Active Arena": hyper-focused live 12-second round. Live prize-pool header,
// a 1..100 progress tracker, the question card with a shrinking countdown bar,
// four answer buttons that flip emerald/crimson on reveal, and a micro-debit
// "Unlock Round N ($0.42)" primary action for broken streaks.
export default function GameScreen({ route, navigation }: Props) {
  const { gameId } = route.params;
  const [round, setRound] = useState<RoundStartPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [purchased, setPurchased] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [lastResult, setLastResult] = useState<RoundEndPayload | null>(null);
  const [streakFree, setStreakFree] = useState(false);
  const [regionBlocked, setRegionBlocked] = useState(false);
  const [prizePoolCents, setPrizePoolCents] = useState(0);
  const [selected, setSelected] = useState<Option | null>(null);
  const [selectedCorrect, setSelectedCorrect] = useState<boolean | null>(null);
  const [isSpectator, setIsSpectator] = useState(false);
  // Per-round outcome history for the progress tracker: 'correct' | 'incorrect'.
  const [history, setHistory] = useState<Record<number, 'correct' | 'incorrect'>>({});

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barAnim = useRef(new Animated.Value(1)).current; // 1 -> 0 over the round
  const poolPulse = useRef(new Animated.Value(1)).current;
  const trackerRef = useRef<ScrollView | null>(null);

  // Geo-fence: verify device location once when the arena opens (server records
  // the region; buy_round is the hard enforcement).
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('geo-check', {
          body: { state: undefined, radarToken: undefined },
        });
        if (!error && data?.regionBlocked) setRegionBlocked(true);
      } catch {
        /* non-fatal; buy_round enforces regardless */
      }
    })();
    fetchPool();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    const channel = supabase.channel(`game:${gameId}`);
    channel
      .on('broadcast', { event: 'round:start' }, ({ payload }) => {
        const p = payload as RoundStartPayload;
        setRound(p);
        setPurchased(false);
        setSelected(null);
        setSelectedCorrect(null);
        setStreakFree(false);
        setPhase('open');
        setLastResult(null);
        startCountdown(p);
        fetchPool(); // pool climbed from last round's buy-ins
        scrollTrackerTo(p.roundNumber);
        detectSpectator(p);
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

  // In Sudden Death Overtime only the tied finalists can play; everyone else is a
  // spectator (chat + watch). Outside overtime, nobody is a spectator.
  async function detectSpectator(p: RoundStartPayload) {
    if (!p.isOvertime) {
      setIsSpectator(false);
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    const { data: part } = await supabase
      .from('sudden_death_participants')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('user_id', u.user?.id ?? '')
      .maybeSingle();
    setIsSpectator(!part);
  }

  async function fetchPool() {
    const { data } = await supabase
      .from('games')
      .select('total_prize_pool_cents')
      .eq('game_id', gameId)
      .single();
    if (data && typeof data.total_prize_pool_cents === 'number') updatePool(data.total_prize_pool_cents);
  }

  function updatePool(next: number) {
    setPrizePoolCents((prev) => {
      if (next > prev) {
        // "tick upward" pulse when the jackpot grows
        Animated.sequence([
          Animated.timing(poolPulse, { toValue: 1.12, duration: 120, useNativeDriver: true }),
          Animated.spring(poolPulse, { toValue: 1, useNativeDriver: true }),
        ]).start();
      }
      return next;
    });
  }

  function startCountdown(p: RoundStartPayload) {
    if (tickRef.current) clearInterval(tickRef.current);
    const total = p.timeLimitSeconds * 1000;
    const deadline = p.serverStartTimeMs + total;
    const remaining = Math.max(deadline - Date.now(), 0);
    barAnim.setValue(total > 0 ? remaining / total : 0);
    Animated.timing(barAnim, { toValue: 0, duration: remaining, useNativeDriver: false }).start();
    tickRef.current = setInterval(() => {
      const remMs = deadline - Date.now();
      setSecondsLeft(Math.max(Math.ceil(remMs / 1000), 0));
      if (remMs <= 0 && tickRef.current) clearInterval(tickRef.current);
    }, 200);
  }

  function scrollTrackerTo(roundNumber: number) {
    requestAnimationFrame(() =>
      trackerRef.current?.scrollTo({ x: Math.max((roundNumber - 4) * 26, 0), animated: true })
    );
  }

  async function buyRound() {
    if (!round) return;
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
    if (data?.gamePoolState?.totalPrizePoolCents != null) updatePool(data.gamePoolState.totalPrizePoolCents);
    setPurchased(true);
  }

  async function answer(option: Option) {
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
    setPhase('answered');
    setSelectedCorrect(Boolean(data.isCorrect));
    setHistory((h) => ({ ...h, [round.roundNumber]: data.isCorrect ? 'correct' : 'incorrect' }));
  }

  const tollLabel = round ? `Unlock Round ${round.roundNumber} (${money(round.costCents)})` : '';

  function renderTracker() {
    const current = round?.roundNumber ?? 0;
    return (
      <ScrollView
        ref={trackerRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tracker}
        contentContainerStyle={styles.trackerContent}
      >
        {Array.from({ length: 100 }, (_, i) => i + 1).map((n) => {
          const outcome = history[n];
          const isCurrent = n === current;
          const dotStyle = [
            styles.dot,
            outcome === 'correct' && styles.dotCorrect,
            outcome === 'incorrect' && styles.dotIncorrect,
            isCurrent && styles.dotCurrent,
            !outcome && !isCurrent && n > current && styles.dotLocked,
          ];
          return (
            <View key={n} style={dotStyle}>
              {n > current && !outcome ? <Text style={styles.lockGlyph}>🔒</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    );
  }

  function optionStyle(key: Option) {
    // Reveal colors: your pick turns emerald/crimson; once the round ends the
    // correct answer always shows emerald.
    const revealedCorrect = lastResult?.correctOption as Option | undefined;
    if (revealedCorrect && key === revealedCorrect) return [styles.optionButton, styles.optionCorrect];
    if (selected === key && selectedCorrect === true) return [styles.optionButton, styles.optionCorrect];
    if (selected === key && selectedCorrect === false) return [styles.optionButton, styles.optionIncorrect];
    if (selected === key) return [styles.optionButton, styles.optionSelected];
    return [styles.optionButton];
  }

  if (!round) {
    return (
      <View style={[styles.container, styles.content]}>
        <PrizeHeader prizePoolCents={prizePoolCents} pulse={poolPulse} />
        <Text style={styles.waiting}>Waiting for the next round to start…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <PrizeHeader prizePoolCents={prizePoolCents} pulse={poolPulse} />
      {renderTracker()}

      {round.isOvertime && <Text style={styles.overtimeBanner}>⚡ SUDDEN DEATH OVERTIME</Text>}
      <Text style={styles.roundLabel}>
        Round {round.roundNumber}
        {!round.isOvertime && ' / 100'} · {secondsLeft}s
      </Text>

      {/* Question card + shrinking countdown bar */}
      <View style={styles.card}>
        <Text style={styles.question}>{round.questionText}</Text>
        <View style={styles.barTrack}>
          <Animated.View
            style={[
              styles.barFill,
              {
                width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: secondsLeft <= 3 ? theme.crimson : theme.emerald,
              },
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

      {/* Micro-debit action state: primary button shows the entry toll */}
      {!purchased && phase === 'open' && !regionBlocked && !isSpectator && (
        <Pressable style={styles.buyButton} onPress={buyRound}>
          <Text style={styles.buyButtonText}>{tollLabel}</Text>
        </Pressable>
      )}

      {purchased && streakFree && phase !== 'closed' && (
        <Text style={styles.streakBadge}>FREE — streak bonus! 🔥</Text>
      )}

      {purchased && phase !== 'closed' && (
        <View style={styles.options}>
          {(Object.entries(round.options) as [Option, string][]).map(([key, label]) => (
            <Pressable key={key} disabled={!!selected} style={optionStyle(key)} onPress={() => answer(key)}>
              <Text style={styles.optionKey}>{key}</Text>
              <Text style={styles.optionText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {phase === 'answered' && !lastResult && (
        <Text style={styles.waiting}>Answer locked in — waiting for the round to end…</Text>
      )}

      {/* Sudden Death: spectators watch + chat; everyone sees the finalists' scores */}
      {round.isOvertime && (
        <>
          {isSpectator && <Text style={styles.spectatorBanner}>👀 Spectating the finalists</Text>}
          {lastResult?.leaderboard?.length ? (
            <View style={styles.finalists}>
              <Text style={styles.finalistsTitle}>FINALISTS</Text>
              {lastResult.leaderboard.slice(0, 3).map((row, i) => (
                <View key={row.userId} style={styles.finalistRow}>
                  <Text style={styles.finalistName}>#{i + 1} Player {row.userId.slice(0, 4)}</Text>
                  <Text style={styles.finalistScore}>{row.score} pts</Text>
                </View>
              ))}
            </View>
          ) : null}
          <ChatPanel gameId={gameId} />
        </>
      )}
    </ScrollView>
  );
}

function PrizeHeader({ prizePoolCents, pulse }: { prizePoolCents: number; pulse: Animated.Value }) {
  return (
    <View style={styles.prizeHeader}>
      <Text style={styles.prizeLabel}>LIVE PRIZE POOL</Text>
      <Animated.Text style={[styles.prizeValue, { transform: [{ scale: pulse }] }]}>
        {money(prizePoolCents)}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingTop: 56, paddingBottom: 40 },
  waiting: { color: theme.textMuted, fontSize: 16, textAlign: 'center', marginTop: 48 },

  spectatorBanner: { color: theme.gold, fontWeight: '800', fontSize: 14, marginTop: 8 },
  finalists: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 14,
    marginTop: 12,
  },
  finalistsTitle: { color: theme.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 8 },
  finalistRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  finalistName: { color: theme.text, fontWeight: '700' },
  finalistScore: { color: theme.gold, fontWeight: '800' },

  prizeHeader: {
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 12,
    marginBottom: 12,
  },
  prizeLabel: { color: theme.gold, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  prizeValue: { color: theme.gold, fontSize: 34, fontWeight: '900', marginTop: 2 },

  tracker: { flexGrow: 0, marginBottom: 16 },
  trackerContent: { gap: 6, alignItems: 'center', paddingVertical: 2 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotCorrect: { backgroundColor: theme.emerald },
  dotIncorrect: { backgroundColor: theme.crimson },
  dotCurrent: { backgroundColor: theme.gold, transform: [{ scale: 1.2 }] },
  dotLocked: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
  lockGlyph: { fontSize: 9, opacity: 0.5 },

  overtimeBanner: { color: theme.crimson, fontSize: 14, fontWeight: '800', letterSpacing: 1, marginBottom: 4 },
  roundLabel: { color: theme.textMuted, fontSize: 14, marginBottom: 10 },

  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    marginBottom: 18,
  },
  question: { color: theme.text, fontSize: 21, fontWeight: '700', marginBottom: 18, lineHeight: 28 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: theme.surfaceAlt, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  blockedBox: { backgroundColor: theme.crimson + '22', borderRadius: 12, padding: 16 },
  blockedText: { color: theme.crimson, fontSize: 15 },

  buyButton: {
    backgroundColor: theme.emerald,
    borderRadius: 14,
    paddingVertical: 18,
    shadowColor: theme.emerald,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  buyButtonText: { color: theme.bg, textAlign: 'center', fontWeight: '900', fontSize: 17 },

  streakBadge: { color: theme.emerald, fontWeight: '800', marginBottom: 12, fontSize: 15 },

  options: { gap: 12, marginTop: 4 },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  optionSelected: { borderColor: theme.gold },
  optionCorrect: { backgroundColor: theme.emeraldDeep, borderColor: theme.emerald },
  optionIncorrect: { backgroundColor: '#5A1B24', borderColor: theme.crimson },
  optionKey: { color: theme.textMuted, fontWeight: '800', fontSize: 16, width: 26 },
  optionText: { color: theme.text, fontSize: 16, flex: 1 },
});
