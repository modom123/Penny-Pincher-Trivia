import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, Image } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme';

export default function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === 'signUp') {
        await signUp(email, password, username);
        Alert.alert('Check your email', 'Confirm your account, then sign in.');
        setMode('signIn');
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.subtitle}>{mode === 'signIn' ? 'Sign in' : 'Create an account'}</Text>

      {mode === 'signUp' && (
        <TextInput
          style={styles.input}
        placeholderTextColor={theme.textMuted}
          placeholder="Username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
        />
      )}
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.textMuted}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.textMuted}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? 'Please wait...' : mode === 'signIn' ? 'Sign In' : 'Sign Up'}</Text>
      </Pressable>

      <Pressable onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
        <Text style={styles.switchText}>
          {mode === 'signIn' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.bg },
  logo: { width: '90%', maxWidth: 300, height: 150, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '800', color: theme.text, textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 16, color: theme.textMuted, textAlign: 'center', marginBottom: 24 },
  input: {
    backgroundColor: theme.surface,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  button: { backgroundColor: theme.gold, borderRadius: 999, paddingVertical: 15, marginTop: 8 },
  buttonText: { color: theme.bg, textAlign: 'center', fontWeight: '800', fontSize: 16 },
  switchText: { color: theme.textMuted, textAlign: 'center', marginTop: 16 },
});
