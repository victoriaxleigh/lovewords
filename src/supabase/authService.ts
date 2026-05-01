import { supabase } from './config';

export async function register(email: string, password: string, displayName: string) {
  const emailLower = email.toLowerCase().trim();

  const { data, error } = await supabase.auth.signUp({
    email: emailLower,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) throw error;

  // Save profile row
  if (data.user) {
    const { error: profileError } = await supabase.from('profiles').upsert({
      id: data.user.id,
      email: emailLower,
      display_name: displayName,
    });
    if (profileError) throw profileError;
  }
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

export async function getUserByEmail(email: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .single();
  if (error) return null;
  return data;
}
