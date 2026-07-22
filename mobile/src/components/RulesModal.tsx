import React from 'react';
import { Modal, View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme';

type Props = { visible: boolean; onClose: () => void };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

// In-app quick reference for how a game actually plays, for the lobby's
// "how it works" link. This describes existing product mechanics only - it is
// not the Official Rules / Terms of Service (see the footnote below), so it
// doesn't need the same legal sign-off those documents do.
export default function RulesModal({ visible, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>How Games Work</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Section title="The basics">
            <Bullet>Each game runs up to 100 rounds. Every round is one multiple-choice trivia question, answered under a countdown timer.</Bullet>
            <Bullet>Unlocking a round costs tokens from your wallet — a small toll per question, not one flat entry fee.</Bullet>
            <Bullet>Buy-ins from every player fund that game's live prize pool, shown at the top of the screen while you play.</Bullet>
          </Section>

          <Section title="Game modes">
            <Bullet><Text style={styles.bold}>The Escalator </Text>— each round costs more than the last (Round N costs N¢), so the toll rises as the game goes on.</Bullet>
            <Bullet><Text style={styles.bold}>Streak Saver </Text>— string together correct answers and you can play rounds for free while your streak holds.</Bullet>
            <Bullet><Text style={styles.bold}>Milestone Booster </Text>— flat-rate tiers (Bronze → Platinum) instead of a cost that changes every round.</Bullet>
          </Section>

          <Section title={'Streak bonus — "3 the hard way"'}>
            <Bullet>Answer three rounds correctly in a row and you get a cash bonus credited to your wallet immediately, plus your next round unlocked for free.</Bullet>
          </Section>

          <Section title="Skips">
            <Bullet>Every game gives you a few free skips. Skipping costs nothing and isn't held against you — it just moves you to the next round without buying in.</Bullet>
          </Section>

          <Section title="How winners are paid">
            <Bullet><Text style={styles.bold}>Standard </Text>— payouts scale with how many people played.</Bullet>
            <Bullet><Text style={styles.bold}>Classic Top 3 </Text>— the top 3 finishers split 50/30/20.</Bullet>
            <Bullet><Text style={styles.bold}>Winner-Take-Most </Text>— 70/20/10 to the top 3.</Bullet>
            <Bullet><Text style={styles.bold}>Spread the Wealth </Text>— roughly the top 25% of finishers share the pool.</Bullet>
            <Bullet>Each game card in the Lobby shows which scheme it's using before you join.</Bullet>
          </Section>

          <Section title="Sudden Death Overtime">
            <Bullet>If the game reaches its final round with tied leaders, those tied players face off in a live tiebreaker to decide the winner. Everyone else becomes a spectator — you can still watch and chat, just not answer.</Bullet>
          </Section>

          <Section title="Your wallet">
            <Bullet>Token bundles include bonus tokens on top of what you pay — bonus tokens play just like cash but can't be withdrawn.</Bullet>
            <Bullet>Only your cash balance can be withdrawn, and identity verification (18+) is required before your first withdrawal.</Bullet>
          </Section>

          <Text style={styles.footnote}>
            This is a quick reference, not the full Terms of Service or Official Rules — see pennypinchingtrivia.com for the complete legal terms.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerTitle: { color: theme.text, fontSize: 20, fontWeight: '900' },
  closeBtn: { backgroundColor: theme.surface, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 },
  closeText: { color: theme.emerald, fontWeight: '800', fontSize: 14 },

  scroll: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 22 },
  sectionTitle: { color: theme.gold, fontSize: 14, fontWeight: '900', letterSpacing: 0.5, marginBottom: 10 },
  bulletRow: { flexDirection: 'row', marginBottom: 8, paddingRight: 4 },
  bulletDot: { color: theme.cyan, fontSize: 15, marginRight: 8, lineHeight: 21 },
  bulletText: { color: theme.text, fontSize: 14, lineHeight: 21, flex: 1 },
  bold: { fontWeight: '900', color: theme.text },

  footnote: { color: theme.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8, fontStyle: 'italic' },
});
