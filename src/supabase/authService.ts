import { supabase } from './config';
import { FUNCTIONS_BASE } from '../utils/apiBase';

export async function register(email: string, password: string, displayName: string) {
  const emailLower = email.toLowerCase().trim();

  const { data, error } = await supabase.auth.signUp({
    email: emailLower,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;

  // The profiles row is created server-side by the on_auth_user_created
  // trigger (see supabase_schema.sql). Doing it here from the client fails
  // under RLS when email-confirmation is on, because signUp() returns no
  // session yet and auth.uid() is null.
  return data.user;
}

export async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.toLowerCase().trim(),
    password,
  });
  if (error) throw error;
  return data.user;
}

export async function logout() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback: (user: any | null) => void) {
  // Get current session immediately
  supabase.auth.getSession().then(({ data: { session } }) => {
    callback(session?.user ?? null);
  });

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => subscription.unsubscribe();
}

// Permanently deletes the current user's account and all their game data.
// Calls the delete-account Netlify function (service-role access — the
// client's anon key can't delete other rows or auth.users itself).
export async function deleteAccount(): Promise<{ success: boolean; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { success: false, error: 'Not signed in' };
  }

  try {
    const res = await fetch(`${FUNCTIONS_BASE}/.netlify/functions/delete-account`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: text || 'Failed to delete account' };
    }
    await logout();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Failed to delete account' };
  }
}

export async function getUserByEmail(email: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (error) return null;
  return data;
}
