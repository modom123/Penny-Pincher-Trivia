import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, StyleSheet, RefreshControl, Modal, TextInput, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { supabase } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { inviteViaEmail, inviteViaSms, inviteViaMore } from '../lib/referral';
import { registerForPushNotificationsAsync } from '../lib/notifications';
import { useAuth } from '../contexts/AuthContext';
import { theme, money } from '../theme';
import RegionGate from '../components/RegionGate';
import Avatar from '../components/Avatar';
import type { RootStackParamList, MainTabParamList } from '../types';

type LobbyNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Home'>,
  NativeStackNavigationProp<RootStackParamList>
>;

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
  min_buy_in_tokens: number | null;
  max_buy_in_tokens: number | null;
  payout_scheme: PayoutScheme;
  round_seconds: number;
};

const MODE_META: Record<GameMode, { label: string; tag: string }> = {
  original_escalator: { label: 'The Escalator', tag: 'Round N costs N¢' },
  streak_saver: { label: 'Streak Saver', tag: 'Play free with a streak' },
  milestone_booster: { label: 'Milestone Booster', tag: 'Flat tiers: Bronze→Platinum' },
};

type PayoutScheme = 'standard' | 'classic_top3' | 'winner_take_most' | 'spread_the_wealth';

const SCHEME_LABELS: Record<PayoutScheme, string> = {
  standard: 'Payouts scale with field size',
  classic_top3: 'Top 3 split 50/30/20',
  winner_take_most: 'Winner-take-most 70/20/10',
  spread_the_wealth: 'Spread the Wealth (~top 25%)',
};

type GamePlayer = { user_id: string; username: string; total_score: number; is_eliminated: boolean };

type ActivityKind = 'won' | 'joined' | 'streak';

type ActivityItem = {
  kind: ActivityKind;
  user_id: string;
  username: string;
  amount_cents: number;
  game_id: string;
  mode: GameMode;
  created_at: string;
};

type ReferralStatus = {
  referralCode: string | null;
  rewardPerReferralCents: number;
  totalReferred: number;
};

function activityText(item: ActivityItem): string {
  const modeLabel = MODE_META[item.mode]?.label ?? item.mode;
  switch (item.kind) {
    case 'won':
      return `won ${money(item.amount_cents)}`;
    case 'streak':
      return `hit a streak — +${money(item.amount_cents)}`;
    case 'joined':
    default:
      return `joined ${modeLabel}`;
  }
}

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
  const navigation = useNavigation<LobbyNavigationProp>();
  const { session } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [signingUp, setSigningUp] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [gamePlayers, setGamePlayers] = useState<Record<string, GamePlayer[]>>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState('');
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [referral, setReferral] = useState<ReferralStatus | null>(null);

  // Registers this device for "tournament starting soon" push alerts (4h and
  // 30min before scheduled_start_at). Once per app launch is plenty - the
  // token rarely changes, and the RPC is a cheap no-op if it hasn't.
  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  // Genuine presence count - only real, currently-connected players (never a
  // fabricated number, which would be misleading on a real-money product).
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    const channel = supabase.channel('lobby-presence', { config: { presence: { key: userId } } });
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.track({ online_at: new Date().toISOString() });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [{ data: gameData }, { data: comp }, { data: activityData }, { data: referralData }] = await Promise.all([
      supabase.rpc('list_lobby_games'),
      supabase.rpc('my_compliance_status'),
      supabase.rpc('list_recent_activity', { p_limit: 20 }),
      supabase.rpc('my_referral_status'),
    ]);
    const gamesTyped = (gameData as unknown as Game[]) ?? [];
    setGames(gamesTyped);
    if (comp && typeof comp.walletBalanceCents === 'number') setBalanceCents(comp.walletBalanceCents);
    if (comp && typeof comp.username === 'string') setUsername(comp.username);
    if (activityData) setActivity(activityData as ActivityItem[]);
    if (referralData) setReferral(referralData as ReferralStatus);

    // Who's signed up / playing - only for games worth showing a roster for.
    const rosterGames = gamesTyped.filter((g) => g.status === 'registration' || g.status === 'active');
    const rosters = await Promise.all(
      rosterGames.map((g) => supabase.rpc('list_game_players', { p_game_id: g.game_id }))
    );
    setGamePlayers((prev) => {
      const next = { ...prev };
      rosterGames.forEach((g, i) => {
        const rows = rosters[i].data as GamePlayer[] | null;
        if (rows) next[g.game_id] = rows;
      });
      return next;
    });

    setRefreshing(false);
  }, []);

  async function submitSuggestion() {
    setSuggestBusy(true);
    try {
      const { error } = await supabase.rpc('submit_topic_suggestion', { p_text: suggestText });
      if (error) throw error;
      setSuggestOpen(false);
      setSuggestText('');
      showAlert('Thanks!', "We'll take a look and may add it as a topic or question.");
    } catch (err) {
      showAlert('Could not submit', (err as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  }

  function inviteFriend(via: 'email' | 'sms' | 'more') {
    if (!referral?.referralCode) return;
    const args: [string, number] = [referral.referralCode, referral.rewardPerReferralCents];
    if (via === 'email') inviteViaEmail(...args);
    else if (via === 'sms') inviteViaSms(...args);
    else inviteViaMore(...args);
  }

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
        showAlert('Could not sign up', msg || error.message);
        return;
      }
      showAlert(
        "You're in!",
        game.status === 'registration'
          ? `Entry paid: ${money(game.entry_fee_cents)}. You'll be ready when the game goes live.`
          : `Entry paid: ${money(game.entry_fee_cents)}. Jump in — you can play from the current round.`
      );
      if (data) load();
    },
    [load]
  );

  const renderRoster = (item: Game) => {
    const players = gamePlayers[item.game_id];
    if (!players || players.length === 0) return null;
    const shown = players.slice(0, 5);
    const extra = players.length - shown.length;
    return (
      <View style={styles.rosterRow}>
        <View style={styles.rosterAvatars}>
          {shown.map((p, i) => (
            <View key={p.user_id} style={[styles.rosterAvatarWrap, { marginLeft: i === 0 ? 0 : -10, zIndex: shown.length - i }]}>
              <Avatar name={p.username} size={26} />
            </View>
          ))}
        </View>
        <Text style={styles.rosterNames} numberOfLines={1}>
          {shown.map((p) => p.username).join(', ')}
          {extra > 0 ? ` +${extra} more` : ''}
        </Text>
      </View>
    );
  };

  const renderGameCard = (item: Game) => {
    const meta = MODE_META[item.mode];
    const isRegistration = item.status === 'registration';
    const canJoin = item.join_open && !item.is_registered;
    const showFooter = (isRegistration || item.status === 'active') && (canJoin || item.is_registered);
    return (
      <Pressable
        key={item.game_id}
        style={[styles.card, isRegistration && styles.cardStatic]}
        disabled={isRegistration}
        onPress={() => navigation.navigate('Game', { gameId: item.game_id })}
      >
        <View style={styles.cardTop}>
          <Text style={styles.cardMode}>{meta.label}</Text>
          {item.subject_name ? <Text style={styles.subjectBadge}>{item.subject_name}</Text> : null}
        </View>
        <Text style={styles.cardTag}>{meta.tag}</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoChip}>⏱ {item.round_seconds}s/question</Text>
          <Text style={styles.infoChip}>🏆 {SCHEME_LABELS[item.payout_scheme] ?? item.payout_scheme}</Text>
          {(item.min_buy_in_tokens != null || item.max_buy_in_tokens != null) && (
            <Text style={styles.infoChip}>
              💰 Buy-in {item.min_buy_in_tokens != null ? money(item.min_buy_in_tokens) : '$0'}–
              {item.max_buy_in_tokens != null ? money(item.max_buy_in_tokens) : '∞'}
            </Text>
          )}
        </View>

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
                <Text style={styles.roundNote}>Still open - join anytime!</Text>
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

        {renderRoster(item)}

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

  const myGames = games.filter((g) => g.is_registered);
  const liveGames = games.filter((g) => g.status === 'active' && !g.is_registered);
  const upcomingGames = games.filter((g) => g.status !== 'active' && !g.is_registered);

  return (
    <View style={styles.container}>
      {/* Brand lockup: the real Penny Pinching Trivia logo, so the Lobby (the
          first screen after sign-in) reads as the app, not a generic games list. */}
      <Image source={require('../../assets/logo.png')} style={styles.brandLogo} resizeMode="contain" />

      {/* Top bar: avatar, unified Penny Wallet balance + quick deposit. Leaderboard,
          full Wallet, Refer & Earn, and sign out live in the bottom tab bar too. */}
      <View style={styles.topBar}>
        <Avatar name={username || '?'} size={36} />
        <Pressable style={styles.walletPill} onPress={() => navigation.navigate('Wallet')}>
          <Text style={styles.walletBalance}>{balanceCents == null ? '—' : money(balanceCents)}</Text>
          <View style={styles.plus}>
            <Text style={styles.plusText}>+</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.headingRow}>
        <View style={styles.headingLeft}>
          <Text style={styles.heading}>Lobby</Text>
          {onlineCount > 0 && (
            <View style={styles.onlinePill}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlinePillText}>{onlineCount} online</Text>
            </View>
          )}
        </View>
        <Pressable onPress={() => setSuggestOpen(true)}>
          <Text style={styles.suggestLink}>💡 Suggest a topic</Text>
        </Pressable>
      </View>

      <RegionGate />

      {activity.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.winnersRow} contentContainerStyle={{ paddingRight: 12 }}>
          {activity.map((a, i) => (
            <View key={`${a.game_id}-${a.user_id}-${i}`} style={styles.winnerChip}>
              <Avatar name={a.username} size={22} />
              <Text style={styles.winnerText}>
                <Text style={styles.winnerName}>{a.username}</Text> {activityText(a)}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl tintColor={theme.emerald} refreshing={refreshing} onRefresh={load} />}
      >
        {games.length === 0 && <Text style={styles.empty}>No games right now. Pull to refresh.</Text>}

        {referral?.referralCode && (
          <View style={styles.referCard}>
            <Pressable onPress={() => navigation.navigate('Refer')}>
              <Text style={styles.referTitle}>🎁 Refer & Earn</Text>
              <Text style={styles.referSub}>
                Share code <Text style={styles.referCode}>{referral.referralCode}</Text> - you both get{' '}
                {money(referral.rewardPerReferralCents)} when they play.
                {referral.totalReferred > 0 ? ` ${referral.totalReferred} referred so far.` : ''}
              </Text>
            </Pressable>
            <View style={styles.referBtnRow}>
              <Pressable style={styles.referBtn} onPress={() => inviteFriend('email')}>
                <Text style={styles.referBtnText}>📧 Email</Text>
              </Pressable>
              <Pressable style={styles.referBtn} onPress={() => inviteFriend('sms')}>
                <Text style={styles.referBtnText}>💬 Text</Text>
              </Pressable>
              <Pressable style={styles.referBtn} onPress={() => inviteFriend('more')}>
                <Text style={styles.referBtnText}>↗️ More</Text>
              </Pressable>
            </View>
          </View>
        )}

        {myGames.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>🎟 My Entries</Text>
            {myGames.map(renderGameCard)}
          </>
        )}

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

      <Modal visible={suggestOpen} transparent animationType="fade" onRequestClose={() => setSuggestOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Suggest a topic or question</Text>
            <Text style={styles.modalSub}>
              Know a topic we should add, or have a question idea? Tell us and our team will review it.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 90s cartoons, or a full question idea…"
              placeholderTextColor={theme.textMuted}
              value={suggestText}
              onChangeText={setSuggestText}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <View style={styles.modalRow}>
              <Pressable style={styles.modalCancel} onPress={() => setSuggestOpen(false)} disabled={suggestBusy}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalSubmit}
                onPress={submitSuggestion}
                disabled={suggestBusy || suggestText.trim().length < 3}
              >
                {suggestBusy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.modalSubmitText}>Submit</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 56, backgroundColor: theme.bg },
  brandLogo: { width: 148, height: 80, alignSelf: 'center', marginBottom: 4 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 12 },
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

  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heading: { color: theme.text, fontSize: 26, fontWeight: '900' },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.emerald },
  onlinePillText: { color: theme.textMuted, fontSize: 12, fontWeight: '700' },
  suggestLink: { color: theme.textMuted, fontSize: 13, fontWeight: '700' },
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
  // Registration-stage cards aren't tappable yet (the game hasn't started) -
  // a plain border instead of a filled surface signals "not a button" so it
  // doesn't look broken when tapping does nothing.
  cardStatic: { backgroundColor: 'transparent', borderStyle: 'dashed' },
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
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  infoChip: {
    color: theme.textMuted,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: theme.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },

  poolRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14 },
  poolLabel: { color: theme.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  poolValue: { color: theme.gold, fontSize: 26, fontWeight: '900', marginTop: 2 },
  roundBox: { backgroundColor: theme.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'flex-end' },
  roundText: { color: theme.text, fontWeight: '700', fontSize: 13 },
  roundLabelSm: { color: theme.textMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  countdown: { color: theme.text, fontWeight: '900', fontSize: 15, marginTop: 2, fontVariant: ['tabular-nums'] },
  roundNote: { color: theme.emerald, fontSize: 9, fontWeight: '700', marginTop: 2 },

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

  rosterRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  rosterAvatars: { flexDirection: 'row', marginRight: 8 },
  rosterAvatarWrap: { borderWidth: 2, borderColor: theme.surface, borderRadius: 15 },
  rosterNames: { color: theme.textMuted, fontSize: 12, fontWeight: '600', flex: 1 },

  referCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.gold,
    padding: 16,
    marginBottom: 16,
  },
  referBtnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  referBtn: {
    flex: 1,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  referBtnText: { color: theme.text, fontWeight: '800', fontSize: 13 },
  referTitle: { color: theme.text, fontWeight: '900', fontSize: 15, marginBottom: 4 },
  referSub: { color: theme.textMuted, fontSize: 12, lineHeight: 17 },
  referCode: { color: theme.gold, fontWeight: '900' },

  winnersRow: { marginTop: 4, marginBottom: 16 },
  winnerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    gap: 8,
  },
  winnerText: { color: theme.textMuted, fontSize: 12, fontWeight: '600' },
  winnerName: { color: theme.text, fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: theme.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 20 },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '900', marginBottom: 6 },
  modalSub: { color: theme.textMuted, fontSize: 13, marginBottom: 14 },
  modalInput: {
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalCancel: { paddingVertical: 12, paddingHorizontal: 16 },
  modalCancelText: { color: theme.textMuted, fontWeight: '700' },
  modalSubmit: { backgroundColor: theme.emerald, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, minWidth: 90, alignItems: 'center' },
  modalSubmitText: { color: theme.bg, fontWeight: '900' },
});
