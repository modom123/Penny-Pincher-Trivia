import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, TextInput, ScrollView } from 'react-native';
import { supabase } from '../lib/supabase';
import { getVerifiedLocationToken } from '../lib/radar';
import { theme } from '../theme';

// Soft-launch region control (Step 2 of the launch playbook). Real-money play is
// geo-fenced to an admin-editable allowlist. Until the Radar.io/GeoComply SDK is
// wired, this lets a verified local tester declare their state, which the server
// records via geo-check -> set_verified_region. buy_round still enforces the hard
// block, so a non-whitelisted pick simply can't buy in.
//
// PRE-RADAR: self-declared location is a stopgap for the controlled soft launch
// only. Wire RADAR_SECRET_KEY + the vendor SDK before the public app-store launch.

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

type Status = {
  regionState: string | null;
  regionBlocked: boolean;
  geofenceEnabled: boolean;
  allowedStates: string[];
};

export default function RegionGate() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

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
    setPickerOpen(false);
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

  const allowed = status?.allowedStates.length ? status.allowedStates : ['TX', 'CA'];
  const sortedAllowed = useMemo(
    () => [...allowed].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)),
    [allowed]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedAllowed;
    return sortedAllowed.filter((s) => (STATE_NAMES[s] ?? s).toLowerCase().includes(q) || s.toLowerCase().includes(q));
  }, [sortedAllowed, search]);

  if (!status) return null;

  // Staff has turned geofencing off entirely (Command Center -> Compliance) --
  // no location declaration needed at all.
  if (!status.geofenceEnabled) return null;

  const ok = status.regionState !== null && !status.regionBlocked;

  if (ok) {
    return (
      <View style={styles.okRow}>
        <Text style={styles.okText}>📍 Playing from {STATE_NAMES[status.regionState!] ?? status.regionState}</Text>
      </View>
    );
  }

  return (
    <View style={styles.gate}>
      <Text style={styles.gateTitle}>Confirm your location to play</Text>
      <Text style={styles.gateSub}>
        Penny Pincher cash games are live in {allowed.length} state{allowed.length === 1 ? '' : 's'}.
        {status.regionState ? ` Your region (${STATE_NAMES[status.regionState] ?? status.regionState}) isn't available yet.` : ''}
      </Text>
      <Pressable style={styles.trigger} onPress={() => setPickerOpen(true)} disabled={busy}>
        {busy ? <ActivityIndicator color={theme.bg} /> : <Text style={styles.triggerText}>Select your state</Text>}
      </Pressable>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>I'm in...</Text>
            <TextInput
              style={styles.searchInput}
              placeholder="Search states"
              placeholderTextColor={theme.textMuted}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
            <ScrollView style={styles.stateList} keyboardShouldPersistTaps="handled">
              {filtered.map((s) => (
                <Pressable key={s} style={styles.stateRow} onPress={() => setRegion(s)}>
                  <Text style={styles.stateRowText}>{STATE_NAMES[s] ?? s}</Text>
                  <Text style={styles.stateRowAbbr}>{s}</Text>
                </Pressable>
              ))}
              {filtered.length === 0 && <Text style={styles.noResults}>No states match "{search}".</Text>}
            </ScrollView>
            <Pressable style={styles.modalCancel} onPress={() => setPickerOpen(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  okRow: { marginBottom: 12 },
  okText: { color: theme.emerald, fontWeight: '700', fontSize: 13 },
  gate: { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  gateTitle: { color: theme.text, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  gateSub: { color: theme.textMuted, fontSize: 13, marginBottom: 12 },
  trigger: { backgroundColor: theme.emerald, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  triggerText: { color: theme.bg, fontWeight: '800', fontSize: 15 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: theme.surface, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 20, maxHeight: '80%' },
  modalTitle: { color: theme.text, fontSize: 18, fontWeight: '900', marginBottom: 12 },
  searchInput: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.text,
    marginBottom: 10,
  },
  stateList: { marginBottom: 6 },
  stateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  stateRowText: { color: theme.text, fontSize: 15, fontWeight: '600' },
  stateRowAbbr: { color: theme.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  noResults: { color: theme.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  modalCancel: { marginTop: 8, alignItems: 'center', paddingVertical: 10 },
  modalCancelText: { color: theme.textMuted, fontSize: 14, fontWeight: '700' },
});
