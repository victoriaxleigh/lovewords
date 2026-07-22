/**
 * Netlify serverless function — sends a push notification to a user via
 * whichever channel(s) they've registered: Web Push (browser/PWA) and/or
 * Expo push (native iOS/Android app). A user can have both; each is
 * independent and best-effort — one failing never blocks the other.
 *
 * Required env vars (Netlify → Site settings → Environment variables):
 *   VAPID_PUBLIC_KEY   — the public key generated during setup
 *   VAPID_PRIVATE_KEY  — the private key generated during setup (keep secret!)
 *   VAPID_EMAIL        — any email address (identifies you to push services)
 *   SUPABASE_URL       — your Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key (NOT the anon key)
 */

const webpush = require('web-push');

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'lovewords@example.com'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { recipientUid, senderName, type, isFriend } = body;
  if (!recipientUid || !senderName || !type) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: 'Supabase env vars not set' };
  }

  const supabaseHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  // Web Push subscription (browser/PWA) and Expo push token (native app) are
  // independent — a user may have one, both, or neither depending on platform.
  const [webPushRes, expoTokenRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientUid)}&select=endpoint,p256dh,auth`,
      { headers: supabaseHeaders }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(recipientUid)}&select=expo_push_token`,
      { headers: supabaseHeaders }
    ),
  ]);

  const webPushRows = await webPushRes.json();
  const profileRows = await expoTokenRes.json();
  const webPushSub = webPushRows && webPushRows[0];
  const expoPushToken = profileRows && profileRows[0] && profileRows[0].expo_push_token;

  if (!webPushSub && !expoPushToken) {
    // Recipient hasn't enabled notifications on any platform — that's fine
    return { statusCode: 200, body: 'No subscription found' };
  }

  // Playful nudges — one is picked at random so it never feels naggy. Partner
  // mode is romantic; Friend mode keeps it light but non-romantic.
  const NUDGES = isFriend
    ? [
        `${senderName} is waiting on your move! 🎲`,
        `Psst 👀 ${senderName} says it's your turn`,
        `${senderName} played — you're up! 🔤`,
        `Tick tock ⏳ ${senderName} wants your word`,
        `${senderName} can't win until you play 😏 your turn`,
        `Your move! ${senderName} is waiting 🎯`,
      ]
    : [
        `${senderName} misses you… and it's your turn 💕`,
        `Psst 👀 ${senderName} is waiting on your move!`,
        `${senderName} sent you a little love-poke 💌 your turn!`,
        `Hey cutie — ${senderName} says it's your move 😘`,
        `${senderName} can't win until you play 😏 your turn 💕`,
        `Tick tock 💗 ${senderName} is waiting for your word!`,
      ];

  const title =
    type === 'turn'
      ? isFriend
        ? '🎲 Your turn on LoveWords!'
        : '💌 Your turn on LoveWords!'
      : type === 'nudge'
      ? `👉 A nudge from ${senderName}`
      : isFriend
      ? `💬 Message from ${senderName}`
      : `💕 Love note from ${senderName}`;

  const message =
    type === 'turn'
      ? `${senderName} just played — go make your move! 🎯`
      : type === 'nudge'
      ? NUDGES[Math.floor(Math.random() * NUDGES.length)]
      : isFriend
      ? `${senderName} sent you a message 💬`
      : `${senderName} left you a little something 💕`;

  const results = await Promise.allSettled([
    webPushSub ? sendWebPush(webPushSub, title, message, supabaseUrl, supabaseHeaders, recipientUid) : Promise.resolve('skipped'),
    expoPushToken ? sendExpoPush(expoPushToken, title, message) : Promise.resolve('skipped'),
  ]);

  results.forEach((r) => {
    if (r.status === 'rejected') console.error('push send error:', r.reason?.message ?? r.reason);
  });

  // Best-effort — a delivery failure on one or both channels never surfaces
  // as an error to the caller; a push notification is never critical path.
  return { statusCode: 200, body: 'Sent' };
};

async function sendWebPush(subscriptionRow, title, message, supabaseUrl, supabaseHeaders, recipientUid) {
  const { endpoint, p256dh, auth } = subscriptionRow;
  const subscription = { endpoint, keys: { p256dh, auth } };
  const payload = JSON.stringify({ title, body: message });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    // 410 = subscription expired/invalid — clean it up
    if (err.statusCode === 410) {
      await fetch(
        `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientUid)}`,
        { method: 'DELETE', headers: supabaseHeaders }
      );
    }
    throw err;
  }
}

async function sendExpoPush(expoPushToken, title, message) {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ to: expoPushToken, title, body: message, sound: 'default' }),
  });
  if (!res.ok) {
    throw new Error(`Expo push API returned ${res.status}`);
  }
}
