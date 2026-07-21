import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { showAlert } from '../lib/alert';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

// Shown right after sign-in when the account has no chosen username yet
// (mainly Google/OAuth players). A unique handle is required so players can be
// tracked on leaderboards, results, and payouts.
export default function UsernamePickerScreen() {
  const { refreshUsername, signOut } = useAuth();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_username', { p_username: username });
      if (error) throw error;
      await refreshUsername();
    } catch (err) {
      showAlert('Try another name', (err as Error).message.replace(/^[A-Z_]+:\s*/, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pick your username</Text>
      <Text style={styles.subtitle}>
        This is how you'll show up on leaderboards and payouts. 3–20 letters, numbers, or underscores.
      </Text>
      <TextInput
        style={styles.input}
        placeholder="username"
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={20}
        value={username}
        onChangeText={setUsername}
      />
      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={save} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Continue'}</Text>
      </Pressable>
      <Pressable onPress={signOut}>
        <Text style={styles.switchText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.bg },
  title: { fontSize: 28, fontWeight: '800', color: theme.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: theme.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 21 },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: { backgroundColor: theme.gold, borderRadius: 999, paddingVertical: 15, marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: theme.bg, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  switchText: { color: theme.textMuted, textAlign: 'center', marginTop: 16 },
});
