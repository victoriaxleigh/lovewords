import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Paste your two values from Supabase → Settings → API
const SUPABASE_URL = 'https://rkgasiixoyhtxlxfchbb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrZ2FzaWl4b3lodHhseGZjaGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTU4NjgsImV4cCI6MjA5MzIzMTg2OH0.UfJLiNzTiH5xt8V6E1KACKC3u0RUNsCWng8sRDHg-u8';

// In dev (`npx expo start`), appending `?dev=1` swaps the real Supabase client
// for an in-memory mock — see ./mockClient.ts. Gated behind __DEV__ so the
// import (and the entire mock module) is dead-code-eliminated from production
// bundles (`npx expo export`), where __DEV__ is a compile-time `false`.
function pickClient() {
  if (__DEV__) {
    const useMock =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('dev');
    if (useMock) {
      // require() inside the __DEV__ branch so Metro tree-shakes it out of prod
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { mockSupabase } = require('./mockClient');
      // eslint-disable-next-line no-console
      console.warn('[lovewords] ?dev=1 — using in-memory mock Supabase. Nothing persists.');
      return mockSupabase;
    }
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

export const supabase = pickClient() as SupabaseClient;
