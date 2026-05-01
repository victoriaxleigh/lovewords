import { createClient } from '@supabase/supabase-js';

// Paste your two values from Supabase → Settings → API
const SUPABASE_URL = 'https://rkgasiixoyhtxlxfchbb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJrZ2FzaWl4b3lodHhseGZjaGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2NTU4NjgsImV4cCI6MjA5MzIzMTg2OH0.UfJLiNzTiH5xt8V6E1KACKC3u0RUNsCWng8sRDHg-u8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
