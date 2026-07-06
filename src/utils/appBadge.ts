// Home Screen app-icon badge (the little number in the corner of the icon).
//
// The service worker (public/sw.js) *increments* the badge when a push arrives
// while the app is closed. This module *clears* it whenever the user is
// actually looking at the app — matching the "clear when I open the app" model.
//
// Badging only does anything on an installed Home Screen web app (iOS 16.4+,
// or desktop Chrome/Edge). Everywhere else these calls no-op safely.

/**
 * Clears the app-icon badge and dismisses any lingering notifications.
 * Safe to call anywhere — guards on feature support and never throws.
 */
export async function clearAppBadge(): Promise<void> {
  if (typeof navigator === 'undefined') return;
  try {
    if ('clearAppBadge' in navigator) {
      await (navigator as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge();
    }
    // Also clear the notification tray so a later push counts from zero again.
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const notes = await reg.getNotifications();
      notes.forEach((n) => n.close());
    }
  } catch {
    // Best-effort — badging/notifications may be unsupported or blocked.
  }
}

/**
 * Clears the badge now and keeps it cleared while the app is open/foregrounded.
 * Returns a cleanup function that removes the listeners.
 */
export function setupBadgeClearing(): () => void {
  if (typeof window === 'undefined') return () => {};

  const clear = () => {
    if (document.visibilityState === 'visible') void clearAppBadge();
  };

  // Clear immediately, and again whenever the app regains focus/visibility
  // (reopening the Home Screen app resumes the page and fires these).
  void clearAppBadge();
  window.addEventListener('focus', clear);
  document.addEventListener('visibilitychange', clear);

  return () => {
    window.removeEventListener('focus', clear);
    document.removeEventListener('visibilitychange', clear);
  };
}
