// Persists an invite code between the moment someone opens an invite link (or
// types a code) and the moment they actually have a signed-in session to redeem
// it with. Registration can require email confirmation, so the code has to
// survive an app reload — hence durable storage rather than in-memory state.

import { Platform } from 'react-native';
import { normalizeInviteCode, isValidInviteCode } from './invites';

const STORAGE_KEY = 'lovewords.pendingInvite';

// Loaded lazily on native so web bundles never pull in the native module.
async function nativeStorage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export async function stashPendingInvite(rawCode: string): Promise<void> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) return;
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, code);
      return;
    }
    const storage = await nativeStorage();
    await storage.setItem(STORAGE_KEY, code);
  } catch {
    // Best-effort: a redemption that can't be stashed is simply not resumed.
  }
}

export async function readPendingInvite(): Promise<string | null> {
  try {
    let value: string | null = null;
    if (Platform.OS === 'web') {
      value = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    } else {
      const storage = await nativeStorage();
      value = await storage.getItem(STORAGE_KEY);
    }
    return isValidInviteCode(value) ? normalizeInviteCode(value) : null;
  } catch {
    return null;
  }
}

export async function clearPendingInvite(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const storage = await nativeStorage();
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — a stale code will fail redemption harmlessly next time.
  }
}
