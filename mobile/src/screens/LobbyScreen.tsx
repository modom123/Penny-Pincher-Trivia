import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
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
  scheduled_start_at: string | null;
  entry_fee_cents: number;
  min_players: number;
  player_count: number;
  is_registered: boolean;
  join_open: boolean;
  subject_name: string | null;
  subject_domain: string | null;
};

const MODE_META: Record<GameMode, { label: string; tag: string }> = {
  original_escalator: { label: 'The Escalator', tag: 'Round N costs N¢' },
  streak_saver: { label: 'Streak Saver', tag: 'Play free with a streak' },
  milestone_booster: { label: 'Milestone Booster', tag: 'Treasure Hunt: collect clues, cash in at Round 100' },
};

// "2d 04h 12m" / "03:59" style countdown to a target ISO timestamp.
function formatCountdown(targetIso: string | null, nowMs: number): string {
  if (!targetIso) return '';
  const ms = new Date(targetIso).getTime() - nowMs;
  if (ms <= 0) return 'Starting…';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function LobbyScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { signOut } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signingUp, setSigningUp] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: gameData }, { data: comp }] = await Promise.all([
      supabase.rpc('list_lobby_games'),
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

  // Tick once a second so the registration countdowns stay live.
  useEffect(() => {
    const hasCountdown = games.some((g) => g.status === 'registration');
    if (!hasCountdown) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [games]);

  const signUp = useCallback(
    async (game: Game) => {
      setSigningUp(game.game_id);
      const { data, error } = await supabase.rpc('register_for_game', { p_game_id: game.game_id });
      setSigningUp(null);
      if (error) {
        // Surface the human-readable half of our coded errors (e.g. INSUFFICIENT_CASH: ...).
        const msg = error.message.includes(':') ? error.message.split(':').slice(1).join(':').trim() : error.message;
        Alert.alert('Could not sign up', msg || error.message);
        return;
      }
      Alert.alert(
        "You're in!",
        game.status === 'registration'
          ? `Entry paid: ${money(game.entry_fee_cents)}. You'll be ready when the game goes live.`
          : `Entry paid: ${money(game.entry_fee_cents)}. Jump in — you can play from the current round.`
      );
      if (data) load();
    },
    [load]
  );

  const renderGameCard = (item: Game) => {
    const meta = MODE_META[item.mode];
    const isRegistration = item.status === 'registration';
    const canJoin = item.join_open && !item.is_registered;
    const showFooter = (isRegistration || item.status === 'active') && (canJoin || item.is_registered);
    return (
      <Pressable
        key={item.game_id}
        style={styles.card}
        disabled={isRegistration}
        onPress={() => navigation.navigate('Game', { gameId: item.game_id })}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardMode}>{meta.label}</Text>
          {item.subject_name ? <Text style={styles.subjectBadge}>{item.subject_name}</Text> : null}
        </View>
        <Text style={styles.cardTag}>{meta.tag}</Text>

        <View style={styles.poolRow}>
          <View>
            <Text style={styles.poolLabel}>PRIZE POOL</Text>
            <Text style={styles.poolValue}>{money(item.total_prize_pool_cents)}</Text>
          </View>
          <View style={styles.roundBox}>
            {isRegistration && item.scheduled_start_at ? (
              <>
                <Text style={styles.roundLabelSm}>STARTS IN</Text>
                <Text style={styles.countdown}>{formatCountdown(item.scheduled_start_at, nowMs)}</Text>
              </>
            ) : isRegistration ? (
              <>
                <Text style={styles.roundLabelSm}>WAITING FOR PLAYERS</Text>
                <Text style={styles.countdown}>{item.player_count}/{item.min_players}</Text>
              </>
            ) : (
              <Text style={styles.roundText}>
                {item.status === 'pending' ? 'Starting soon' : `Round ${item.current_round}/${item.total_rounds}`}
              </Text>
            )}
          </View>
        </View>

        {showFooter && (
          <View style={styles.regFooter}>
            <Text style={styles.regMeta}>
              {item.player_count} {isRegistration ? 'signed up' : 'in'}
              {item.entry_fee_cents > 0 ? `  ·  entry ${money(item.entry_fee_cents)}` : ''}
            </Text>
            {item.is_registered ? (
              <View style={styles.signedUpPill}>
                <Text style={styles.signedUpText}>✓ {isRegistration ? 'Signed up' : "You're in"}</Text>
              </View>
            ) : canJoin ? (
              <Pressable
                style={styles.signUpBtn}
                disabled={signingUp === item.game_id}
                onPress={() => signUp(item)}
              >
                <Text style={styles.signUpText}>
                  {signingUp === item.game_id
                    ? isRegistration
                      ? 'Signing up…'
                      : 'Joining…'
                    : `${isRegistration ? 'Sign up' : 'Join now'}${
                        item.entry_fee_cents > 0 ? ` · ${money(item.entry_fee_cents)}` : ''
                      }`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {item.in_sudden_death && <Text style={styles.suddenDeath}>⚡ SUDDEN DEATH OVERTIME</Text>}
      </Pressable>
    );
  };

  const liveGames = games.filter((g) => g.status === 'active');
  const upcomingGames = games.filter((g) => g.status !== 'active');

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
        <Pressable onPress={() => navigation.navigate('Leaderboard')}>
          <Text style={styles.leaderboardLink}>🏆</Text>
        </Pressable>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.heading}>Games</Text>

      <RegionGate />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl tintColor={theme.emerald} refreshing={refreshing} onRefresh={load} />}
      >
        {games.length === 0 && <Text style={styles.empty}>No games right now. Pull to refresh.</Text>}

        {liveGames.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>🔴 Live Now</Text>
            {liveGames.map(renderGameCard)}
          </>
        )}

        {upcomingGames.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>⏱ Starting Soon</Text>
            {upcomingGames.map(renderGameCard)}
          </>
        )}
      </ScrollView>
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
  leaderboardLink: { fontSize: 22, marginLeft: 14 },
  signOut: { color: theme.textMuted, marginLeft: 14, fontSize: 13 },

  heading: { color: theme.text, fontSize: 26, fontWeight: '900', marginBottom: 14 },
  sectionHeading: { color: theme.textMuted, fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 10, marginTop: 4 },
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
  roundBox: { backgroundColor: theme.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'flex-end' },
  roundText: { color: theme.text, fontWeight: '700', fontSize: 13 },
  roundLabelSm: { color: theme.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  countdown: { color: theme.text, fontWeight: '900', fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] },

  regFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  regMeta: { color: theme.textMuted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  signUpBtn: { backgroundColor: theme.emerald, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  signUpText: { color: theme.bg, fontWeight: '900', fontSize: 14 },
  signedUpPill: {
    backgroundColor: theme.emerald + '22',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.emerald,
  },
  signedUpText: { color: theme.emerald, fontWeight: '800', fontSize: 13 },

  suddenDeath: { color: theme.crimson, fontWeight: '800', fontSize: 12, marginTop: 12, letterSpacing: 1 },
});
