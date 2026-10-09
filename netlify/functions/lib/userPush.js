/**
 * Best-effort push and email for word requests.
 *
 * Push goes out on the same channels as notify.js: Web Push (browser/PWA, via
 * push_subscriptions) and Expo push (native, via profiles.expo_push_token).
 * notify.js is left alone on purpose: it carries the game/love-note delivery
 * claims and its own tests, and these messages need neither.
 *
 * Nothing here throws. A missing VAPID key, subscription or Resend key just
 * means that channel is skipped.
 */

const webpush = require('web-push');
const { supabaseHeaders } = require('../game-analysis-common');

let vapidReady;

function vapidConfigured() {
  if (vapidReady !== undefined) return vapidReady;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    vapidReady = false;
    return vapidReady;
  }
  try {
    webpush.setVapidDetails(
      `mailto:${process.env.VAPID_EMAIL || 'lovewords@example.com'}`,
      publicKey,
      privateKey
    );
    vapidReady = true;
  } catch (error) {
    console.error('vapid setup failed:', error.message);
    vapidReady = false;
  }
  return vapidReady;
}

async function readJson(response) {
  if (!response.ok) return [];
  try {
    const rows = await response.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function pushToUser(config, userId, title, message) {
  const headers = supabaseHeaders(config.supabaseKey);
  const id = encodeURIComponent(userId);
  const [webRows, profileRows] = await Promise.all([
    fetch(
      `${config.supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${id}&select=endpoint,p256dh,auth`,
      { headers }
    ).then(readJson),
    fetch(`${config.supabaseUrl}/rest/v1/profiles?id=eq.${id}&select=expo_push_token`, {
      headers,
    }).then(readJson),
  ]);

  const sends = [];
  const web = webRows[0];
  const channels = { web: Boolean(web), expo: Boolean(profileRows[0]?.expo_push_token) };
  if (web && vapidConfigured()) {
    const subscription = { endpoint: web.endpoint, keys: { p256dh: web.p256dh, auth: web.auth } };
    sends.push(
      webpush.sendNotification(subscription, JSON.stringify({ title, body: message })).catch(
        async (error) => {
          // 410 = subscription expired; clean it up like notify.js does.
          if (error.statusCode === 410) {
            await fetch(`${config.supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${id}`, {
              method: 'DELETE',
              headers,
            });
          }
          throw error;
        }
      )
    );
  }
  const expoToken = profileRows[0]?.expo_push_token;
  if (expoToken) {
    sends.push(
      fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ to: expoToken, title, body: message, sound: 'default' }),
      }).then((response) => {
        if (!response.ok) throw new Error(`Expo push API returned ${response.status}`);
      })
    );
  }
  return { sends, channels };
}

/** Push one message to each user. Awaited, so a Lambda can't freeze mid-send. */
async function pushToUsers(config, userIds, title, message) {
  try {
    const targets = await Promise.all(
      [...new Set(userIds)].map((uid) => pushToUser(config, uid, title, message))
    );
    // One summary line per push, so a silent skip (no subscription, no VAPID keys in
    // this deploy context) shows in the function log.
    console.log(
      `word push "${title}": users=${targets.length}` +
        ` web=${targets.filter((t) => t.channels.web).length}` +
        ` expo=${targets.filter((t) => t.channels.expo).length}` +
        ` vapid=${vapidConfigured() ? 'yes' : 'no'}`
    );
    const sends = targets.flatMap((t) => t.sends);
    const results = await Promise.allSettled(sends);
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('word push error:', result.reason?.message ?? result.reason);
      }
    }
  } catch (error) {
    console.error('word push failed:', error.message);
  }
}

/** User ids for these emails, from profiles. */
async function userIdsForEmails(config, emails) {
  if (emails.length === 0) return [];
  const list = emails.map((email) => `"${email.replace(/"/g, '')}"`).join(',');
  const query = new URLSearchParams({ email: `in.(${list})`, select: 'id' });
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/profiles?${query}`, {
      headers: supabaseHeaders(config.supabaseKey),
    });
    return (await readJson(response)).map((row) => row.id).filter(Boolean);
  } catch (error) {
    console.error('reviewer lookup failed:', error.message);
    return [];
  }
}

/** Email through Resend when RESEND_API_KEY is set (same provider as invites). */
async function sendEmail(to, subject, text, html) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey || to.length === 0) return false;
  const from = process.env.INVITE_FROM_EMAIL || 'LoveWords <onboarding@resend.dev>';
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    if (!response.ok) console.error('word email failed:', response.status);
    return response.ok;
  } catch (error) {
    console.error('word email error:', error.message);
    return false;
  }
}

function resetPushForTests() {
  vapidReady = undefined;
}

module.exports = { pushToUsers, resetPushForTests, sendEmail, userIdsForEmails };
