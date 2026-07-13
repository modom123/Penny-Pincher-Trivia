import { createClient } from '@supabase/supabase-js';

// Public (publishable) Supabase config. Environment variables win when present,
// but if a deploy is missing them we fall back to the known public project
// values — the same ones committed in .env.example and the mobile app.json — so
// the dashboard never boots to a blank screen just because an env var wasn't set.
const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string) ||
  'https://pkvdthwqvjpxhqorfpub.supabase.co';
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  'sb_publishable_kZ17EWaJ8fJy91jAOC-13A_NW5x3iqQ';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
