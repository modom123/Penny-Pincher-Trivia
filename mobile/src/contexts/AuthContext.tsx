import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
  needsUsername: boolean;
  signUp: (email: string, password: string, username: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  refreshUsername: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsUsername, setNeedsUsername] = useState(false);

  const checkUsername = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setNeedsUsername(false);
      return;
    }
    const { data } = await supabase
      .from('profiles')
      .select('username_set')
      .eq('user_id', activeSession.user.id)
      .maybeSingle();
    // Only gate when we positively know the username hasn't been chosen.
    setNeedsUsername(data ? data.username_set === false : false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await checkUsername(data.session);
      setLoading(false);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      await checkUsername(newSession);
    });
    return () => subscription.subscription.unsubscribe();
  }, [checkUsername]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      loading,
      needsUsername,
      async signUp(email, password, username) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username } },
        });
        if (error) throw error;
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      async signInWithGoogle() {
        const redirectTo =
          Platform.OS === 'web' ? window.location.origin + window.location.pathname : undefined;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
        });
        if (error) throw error;
      },
      async refreshUsername() {
        await checkUsername(session);
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, loading, needsUsername, checkUsername]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
