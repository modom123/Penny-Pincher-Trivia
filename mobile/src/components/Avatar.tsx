import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';

const PALETTE = [theme.emerald, theme.gold, theme.pink, theme.cyan, theme.crimson, theme.blue];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export default function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initial = (name?.trim()?.[0] || '?').toUpperCase();
  const bg = colorFor(name || '?');
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.text, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  text: { color: '#0B0B10', fontWeight: '900' },
});
