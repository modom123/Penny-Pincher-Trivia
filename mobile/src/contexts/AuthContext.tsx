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

// Exposed by desktop/preload.js via contextBridge; undefined everywhere else
// (real web, native RN).
type ElectronBridge = {
  isElectron: true;
  onDeepLink(callback: (url: string) => void): () => void;
  onWindowFocus(callback: () => void): () => void;
};
function getElectronBridge(): ElectronBridge | undefined {
  return typeof window !== 'undefined' ? (window as any).electronBridge : undefined;
}

// The Electron shell's window never reloads with the OAuth callback in its
// URL (Google/Trustly can't redirect to file://, so Supabase redirects to a
// pennypincher:// deep link instead - see desktop/main.js), so nothing here
// can rely on detectSessionInUrl. Handle both flow types the client might be
// configured for: PKCE (a `code` param) and implicit (tokens in the hash).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function completeSessionFromDeepLink(url: string) {
  const parsed = new URL(url);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const code = parsed.searchParams.get('code');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');
  const errorDescription = parsed.searchParams.get('error_description') || hashParams.get('error_description');

  if (errorDescription) {
    throw new Error(errorDescription);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) throw error;
  } else if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error) throw error;
  }
}

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
    let cancelled = false;
    // Bootstraps session state on first load. Both calls below used to run
    // unguarded - if getSession() or checkUsername() ever rejected (a
    // corrupted stored session, a slow/failed AsyncStorage-web IndexedDB
    // read, a network hiccup) or simply hung, setLoading(false) was never
    // reached, and RootNavigator's `if (loading) return null` left the app
    // stuck on WebFrame's blue background forever - only a full page reload
    // (which re-runs this from scratch) recovered. The timeout below caps
    // how long a hang can block the UI; the try/finally guarantees loading
    // always clears even on a thrown error.
    (async () => {
      try {
        const { data } = await withTimeout(supabase.auth.getSession(), 6000);
        if (cancelled) return;
        setSession(data.session);
        await withTimeout(checkUsername(data.session), 6000);
      } catch (err) {
        console.warn('Session bootstrap failed, defaulting to signed-out:', (err as Error).message);
        if (!cancelled) {
          setSession(null);
          setNeedsUsername(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      try {
        await withTimeout(checkUsername(newSession), 6000);
      } catch (err) {
        console.warn('checkUsername failed:', (err as Error).message);
      }
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [checkUsername]);

  useEffect(() => {
    const bridge = getElectronBridge();
    if (!bridge) return;
    return bridge.onDeepLink((url) => {
      completeSessionFromDeepLink(url).catch((err) => {
        console.warn('Google sign-in callback failed:', (err as Error).message);
      });
    });
  }, []);

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
        const bridge = getElectronBridge();
        const redirectTo = bridge
          ? 'pennypincher://auth-callback'
          : Platform.OS === 'web'
            // Preserves ?ref=CODE (and anything else in the query string) across
            // the OAuth round trip - dropping it here silently lost every
            // referral code for anyone who signed up with Google instead of
            // email/password, since UsernamePickerScreen reads it back out of
            // window.location.search once Google redirects back to this URL.
            ? window.location.origin + window.location.pathname + window.location.search
            : undefined;
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo, skipBrowserRedirect: !!bridge },
        });
        if (error) throw error;
        // Normally signInWithOAuth navigates the page itself. In Electron that
        // would load Google's consent screen as the packaged app's own
        // top-level document - which Google's OAuth policy blocks outright for
        // embedded/WebView user agents ("This browser or app may not be
        // secure"). skipBrowserRedirect gives us the URL back so we can open
        // it in the user's real system browser instead (setWindowOpenHandler
        // in main.js routes window.open there), which is also where Google
        // expects a desktop app's OAuth consent screen to render.
        if (bridge && data?.url) {
          window.open(data.url, '_blank');
        }
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
