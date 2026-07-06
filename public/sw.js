// LoveWords Service Worker — handles background push notifications

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: '💌 LoveWords', body: event.data.text() };
  }

  const title = payload.title || '💌 LoveWords';
  const options = {
    body: payload.body || "It's your turn!",
    icon: '/apple-touch-icon.png',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200],
    data: { url: payload.url || '/' },
  };

  event.waitUntil(
    (async () => {
      // Home Screen app icon badge (iOS 16.4+ / installed PWAs).
      // Count = notifications still on the tray + the one we're about to show.
      // Opening the app clears it (see clearAppBadge in the app).
      try {
        if ('setAppBadge' in navigator) {
          const existing = await self.registration.getNotifications();
          await navigator.setAppBadge(existing.length + 1);
        }
      } catch {
        // Badging unsupported / not installed — ignore, best-effort.
      }
      await self.registration.showNotification(title, options);
    })()
  );
});

// When user taps the notification, open/focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
