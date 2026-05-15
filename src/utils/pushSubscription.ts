import { supabase } from '../supabase/config';

// This is the PUBLIC key — safe to put in code
const VAPID_PUBLIC_KEY =
  'BAonmTB4A44-9UCHM-GrM3itorKGP3OarN47r3K0vR2mI6qARnjSrXZeUQdFnR5A8BBdTLPPPcTQs_xBlQJ-3BM';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker, asks for notification permission,
 * and saves the push subscription to Supabase so we can reach this device later.
 */
export async function registerPushSubscription(userId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    // Register the service worker
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    // Ask for notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Save to Supabase so the server can reach this device
    const sub = subscription.toJSON();
    await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: (sub.keys as any)?.p256dh,
        auth: (sub.keys as any)?.auth,
      },
      { onConflict: 'user_id' }
    );
  } catch (err) {
    // Silently fail — notifications are best-effort
    console.warn('Push subscription failed:', err);
  }
}
