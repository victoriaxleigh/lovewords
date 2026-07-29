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

  const { recipientUid, type, gameId, eventId } = body;
  const allowedTypes = new Set(['invite', 'turn', 'lovenote', 'nudge']);
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuidPattern.test(recipientUid || '') ||
    !uuidPattern.test(gameId || '') ||
    !allowedTypes.has(type) ||
    (type !== 'nudge' && typeof eventId !== 'string')
  ) {
    return { statusCode: 400, body: 'Missing fields' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: 'Supabase env vars not set' };
  }

  const authorization = event.headers?.authorization || event.headers?.Authorization;
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) {
    return { statusCode: 401, body: 'Missing Authorization header' };
  }

  // New-format Supabase secret keys (`sb_secret_...`) are opaque and are only
  // accepted in the `apikey` header. Sending one as a Bearer token makes
  // PostgREST try to parse it as a JWT and reject the request, which surfaced
  // here as every notification failing with a 502. Legacy service-role keys are
  // JWTs and still expect the `Authorization: Bearer` form, so keep both.
  const supabaseHeaders = { apikey: supabaseKey };
  if (!supabaseKey.startsWith('sb_secret_')) {
    supabaseHeaders.Authorization = `Bearer ${supabaseKey}`;
  }
  const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` },
  });
  if (!authRes.ok) {
    return { statusCode: 401, body: 'Invalid or expired session' };
  }
  const authenticatedUser = await authRes.json();
  const senderUid = authenticatedUser?.id;
  if (!uuidPattern.test(senderUid || '') || senderUid === recipientUid) {
    return { statusCode: 403, body: 'Notification is not authorized' };
  }

  const gameRes = await fetch(
    `${supabaseUrl}/rest/v1/games?id=eq.${encodeURIComponent(gameId)}` +
      '&select=player1_uid,player2_uid,status,current_turn,mode,moves&limit=1',
    { headers: supabaseHeaders }
  );
  if (!gameRes.ok) {
    return { statusCode: 502, body: 'Could not verify game' };
  }
  const gameRows = await gameRes.json();
  const game = gameRows && gameRows[0];
  if (!game) {
    return { statusCode: 404, body: 'Game not found' };
  }

  const senderIsPlayer1 = game.player1_uid === senderUid && game.player2_uid === recipientUid;
  const senderIsPlayer2 = game.player2_uid === senderUid && game.player1_uid === recipientUid;
  const participantsMatch = senderIsPlayer1 || senderIsPlayer2;
  let eventKey;
  let authorized = false;
  if (type === 'invite') {
    authorized = game.status === 'waiting' && senderIsPlayer1 && eventId === gameId;
    eventKey = `invite:${gameId}`;
  } else if (type === 'turn') {
    const moves = Array.isArray(game.moves) ? game.moves : [];
    const moveIndex = moves.length - 1;
    const lastMove = moves[moveIndex];
    authorized =
      game.status === 'active' &&
      participantsMatch &&
      game.current_turn === recipientUid &&
      eventId === String(moveIndex) &&
      lastMove?.uid === senderUid;
    eventKey = `turn:${gameId}:${eventId}`;
  } else if (type === 'nudge') {
    authorized =
      game.status === 'active' && participantsMatch && game.current_turn === recipientUid;
    eventKey = 'nudge';
  } else {
    if (!uuidPattern.test(eventId || '')) {
      return { statusCode: 400, body: 'Invalid notification event' };
    }
    const noteRes = await fetch(
      `${supabaseUrl}/rest/v1/love_notes?id=eq.${encodeURIComponent(eventId)}` +
        '&select=id,game_id,from_uid,to_uid&limit=1',
      { headers: supabaseHeaders }
    );
    if (!noteRes.ok) {
      return { statusCode: 502, body: 'Could not verify notification event' };
    }
    const noteRows = await noteRes.json();
    const note = noteRows && noteRows[0];
    authorized =
      game.status === 'active' &&
      participantsMatch &&
      note?.game_id === gameId &&
      note?.from_uid === senderUid &&
      note?.to_uid === recipientUid;
    eventKey = `lovenote:${eventId}`;
  }
  if (!authorized) {
    return { statusCode: 403, body: 'Notification is not authorized' };
  }
  const isFriend = game.mode === 'friend';

  // Claim this delivery atomically before reading push tokens. The SQL
  // function deduplicates immutable events and applies a sender/recipient/type
  // limit across every game. It is executable only by the service role.
  const deliveryClaimRes = await fetch(
    `${supabaseUrl}/rest/v1/rpc/claim_notification_delivery`,
    {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claim_sender_uid: senderUid,
        claim_recipient_uid: recipientUid,
        claim_notification_type: type,
        claim_event_key: eventKey,
      }),
    }
  );
  if (!deliveryClaimRes.ok) {
    return { statusCode: 502, body: 'Could not reserve notification delivery' };
  }
  const deliveryClaimed = await deliveryClaimRes.json();
  if (deliveryClaimed !== true) {
    return { statusCode: 429, body: 'Notification cooldown active' };
  }

  // Web Push subscription (browser/PWA) and Expo push token (native app) are
  // independent — a user may have one, both, or neither depending on platform.
  const [senderProfileRes, webPushRes, expoTokenRes] = await Promise.all([
    fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(senderUid)}&select=display_name`,
      { headers: supabaseHeaders }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(recipientUid)}&select=endpoint,p256dh,auth`,
      { headers: supabaseHeaders }
    ),
    fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(recipientUid)}&select=expo_push_token`,
      { headers: supabaseHeaders }
    ),
  ]);

  const senderProfileRows = await senderProfileRes.json();
  const webPushRows = await webPushRes.json();
  const profileRows = await expoTokenRes.json();
  const senderName = senderProfileRows?.[0]?.display_name || 'Someone';
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
    type === 'invite'
      ? `${isFriend ? '🎲' : '💌'} Game invite from ${senderName}`
      : type === 'turn'
      ? isFriend
        ? '🎲 Your turn on LoveWords!'
        : '💌 Your turn on LoveWords!'
      : type === 'nudge'
      ? `👉 A nudge from ${senderName}`
      : isFriend
      ? `💬 Message from ${senderName}`
      : `💕 Love note from ${senderName}`;

  const message =
    type === 'invite'
      ? `${senderName} invited you to play LoveWords.`
      : type === 'turn'
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
