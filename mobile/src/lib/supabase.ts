import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Lets supabase-js pick up the session from the URL when Google OAuth
    // redirects back on web/desktop (a no-op on native RN — there's no
    // window.location there). The Electron deep-link callback is consumed
    // separately (see AuthContext), since it never reloads this page.
    detectSessionInUrl: true,
  },
});

// supabase.functions.invoke()'s error.message is always the generic
// "Edge Function returned a non-2xx status code" - the real reason our edge
// functions send back (e.g. "Trustly establish error: ...") lives in
// error.context, the raw Response, and has to be read separately.
export async function edgeFunctionErrorMessage(error: unknown): Promise<string> {
  const withContext = error as { context?: Response; message?: string };
  if (withContext?.context && typeof withContext.context.json === 'function') {
    try {
      const body = await withContext.context.json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // Response body wasn't JSON (or was already consumed) - fall through.
    }
  }
  return withContext?.message ?? 'Something went wrong. Please try again.';
}
