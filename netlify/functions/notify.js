/**
 * Netlify serverless function — sends a Web Push notification to a user.
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

  const { recipientUid, senderName, type } = body;
  if (!recipientUid || !senderName || !type) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  // Fetch the recipient's push subscription from Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: 'Supabase env vars not set' };
  }

  const res = await fetch(
    `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientUid)}&select=endpoint,p256dh,auth`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  );

  const rows = await res.json();
  if (!rows || rows.length === 0) {
    // Recipient hasn't enabled notifications — that's fine
    return { statusCode: 200, body: 'No subscription found' };
  }

  const { endpoint, p256dh, auth } = rows[0];
  const subscription = { endpoint, keys: { p256dh, auth } };

  const title =
    type === 'turn'
      ? '💌 Your turn on LoveWords!'
      : `💕 Love note from ${senderName}`;

  const message =
    type === 'turn'
      ? `${senderName} just played — go make your move! 🎯`
      : `${senderName} left you a little something 💕`;

  const payload = JSON.stringify({ title, body: message });

  try {
    await webpush.sendNotification(subscription, payload);
    return { statusCode: 200, body: 'Sent' };
  } catch (err) {
    // 410 = subscription expired/invalid — clean it up
    if (err.statusCode === 410) {
      await fetch(
        `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientUid)}`,
        {
          method: 'DELETE',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        }
      );
    }
    console.error('webpush error:', err.message);
    return { statusCode: 200, body: 'Notification failed (non-fatal)' };
  }
};
