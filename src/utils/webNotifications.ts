/**
 * Browser push notifications — works on web even when tab is in background.
 * No extra accounts or services needed!
 */

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window)) return false;

  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export function sendTurnNotification(opponentName: string) {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  new Notification('💌 Your turn on LoveWords!', {
    body: `${opponentName} just played — it's your move!`,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
  });
}

export function sendLoveNoteNotification(fromName: string, message: string) {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  new Notification(`💕 Love note from ${fromName}`, {
    body: message,
    icon: '/favicon.ico',
  });
}
