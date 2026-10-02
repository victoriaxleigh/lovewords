// Remembers that a password-recovery link was opened on this device until the
// user has actually set a new password (or backed out). Without this, closing
// the tab mid-reset would leave the recovery session in storage, and the next
// launch would silently sign them in — still without a known password.

import { Platform } from 'react-native';

const STORAGE_KEY = 'lovewords.pendingRecovery';

// Loaded lazily on native so web bundles never pull in the native module.
async function nativeStorage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export async function markRecoveryPending(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, '1');
      return;
    }
    const storage = await nativeStorage();
    await storage.setItem(STORAGE_KEY, '1');
  } catch {
    // Best-effort: the in-memory recovery state still holds for this launch.
  }
}

export async function isRecoveryPending(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === '1';
    }
    const storage = await nativeStorage();
    return (await storage.getItem(STORAGE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function clearRecoveryPending(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const storage = await nativeStorage();
    await storage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — a stale flag just shows the recovery screen once more.
  }
}
