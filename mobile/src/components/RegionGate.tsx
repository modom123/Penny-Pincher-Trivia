import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { getVerifiedLocationToken } from '../lib/radar';
import { theme } from '../theme';

// Soft-launch region control (Step 2 of the launch playbook). Real-money play is
// geo-fenced to the allowlist (TX, CA at soft launch). Until the Radar.io/GeoComply
// SDK is wired, this lets a verified local tester declare their state, which the
// server records via geo-check -> set_verified_region. buy_round still enforces the
// hard block, so a non-whitelisted pick simply can't buy in.
//
// PRE-RADAR: self-declared location is a stopgap for the controlled soft launch
// only. Wire RADAR_SECRET_KEY + the vendor SDK before the public app-store launch.

type Status = {
  regionState: string | null;
  regionBlocked: boolean;
  geofenceEnabled: boolean;
  allowedStates: string[];
};

export default function RegionGate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('my_compliance_status');
    if (data) {
      setStatus({
        regionState: data.regionState ?? null,
        regionBlocked: Boolean(data.regionBlocked),
        // Defaults to true (matches the server default) if an older cached
        // response is ever missing the field.
        geofenceEnabled: data.geofenceEnabled ?? true,
        allowedStates: (data.allowedStates as string[]) ?? [],
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setRegion(state: string) {
    setBusy(true);
    try {
      // On device builds this returns an anti-spoofed Radar token; geo-check reads
      // the verified state from it and ignores the declared one. Null on web/soft
      // launch, where the declared `state` is accepted as a stopgap.
      const radarToken = await getVerifiedLocationToken();
      await supabase.functions.invoke('geo-check', { body: { state, radarToken } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  // Staff has turned geofencing off entirely (Command Center -> Compliance) --
  // no location declaration needed at all.
  if (!status.geofenceEnabled) return null;

  const allowed = status.allowedStates.length > 0 ? status.allowedStates : ['TX', 'CA'];
  const ok = status.regionState !== null && !status.regionBlocked;

  if (ok) {
    return (
      <View style={styles.okRow}>
        <Text style={styles.okText}>📍 Playing from {status.regionState}</Text>
      </View>
    );
  }

  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>Confirm your location to play</Text>
      <Text style={styles.gateSub}>
        Penny Pincher cash games are live in {allowed.join(', ')}.
        {status.regionState ? ` Your region (${status.regionState}) isn't available yet.` : ''}
      </Text>
      <View style={styles.pickRow}>
        {allowed.map((s) => (
          <Pressable key={s} style={styles.pick} onPress={() => setRegion(s)} disabled={busy}>
            {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.pickText}>I'm in {s}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  okRow: { marginBottom: 12 },
  okText: { color: theme.emerald, fontWeight: '700', fontSize: 13 },
  gate: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  gateTitle: { color: theme.text, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  gateSub: { color: theme.textMuted, fontSize: 13, marginBottom: 12 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pick: { flex: 1, backgroundColor: theme.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  pickText: { color: theme.bg, fontWeight: '800', fontSize: 15 },
});
