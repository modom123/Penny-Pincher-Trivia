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
