/**
 * Netlify serverless function — emails a LoveWords invite link to someone who
 * isn't on the app yet. The invite code itself is minted by the
 * `create_email_invite` Postgres function (see the email_invites migration);
 * this endpoint only *delivers* it by email.
 *
 * Email delivery is optional and degrades gracefully: if no email provider is
 * configured the function returns `{ emailed: false, reason: 'not_configured' }`
 * with a 200, and the client falls back to letting the inviter copy/share the
 * link (or text the code) themselves. Wire up delivery by setting:
 *
 *   RESEND_API_KEY    — a Resend API key (https://resend.com). When present,
 *                       invites are sent through Resend's REST API.
 *   INVITE_FROM_EMAIL — the From address, e.g. "LoveWords <play@yourdomain>".
 *                       Defaults to Resend's shared onboarding sender.
 *   APP_URL           — public site origin used to build the invite link.
 *                       Defaults to the production Netlify URL.
 *
 * Auth model matches notify.js: the caller sends their Supabase access token as
 * a Bearer header, and the function verifies (with the service key) that the
 * caller actually owns the pending invite before emailing anyone.
 *
 * Required env vars:
 *   SUPABASE_URL         — your Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key (NOT the anon key)
 */

const DEFAULT_APP_URL = 'https://lovewords1234.netlify.app';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

  const rawCode = typeof body.code === 'string' ? body.code : '';
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 8) {
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

  // New-format Supabase secret keys (`sb_secret_...`) are opaque and only work
  // in the `apikey` header; legacy service-role keys are JWTs sent as Bearer.
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
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(senderUid || '')) {
    return { statusCode: 403, body: 'Not authorized' };
  }

  // Only the inviter may send their own pending invite.
  const inviteRes = await fetch(
    `${supabaseUrl}/rest/v1/email_invites?code=eq.${encodeURIComponent(code)}` +
      '&select=inviter_uid,invitee_email,mode,status,expires_at&limit=1',
    { headers: supabaseHeaders }
  );
  if (!inviteRes.ok) {
    return { statusCode: 502, body: 'Could not verify invite' };
  }
  const inviteRows = await inviteRes.json();
  const invite = inviteRows && inviteRows[0];
  if (!invite || invite.status !== 'pending' || invite.inviter_uid !== senderUid) {
    return { statusCode: 403, body: 'Not authorized' };
  }

  if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailed: false, reason: 'expired' }),
    };
  }

  const inviteeEmail = invite.invitee_email;
  if (!inviteeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteeEmail)) {
    return { statusCode: 422, body: 'Invite has no deliverable email' };
  }

  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(senderUid)}` +
      '&select=display_name&limit=1',
    { headers: supabaseHeaders }
  );
  const profileRows = profileRes.ok ? await profileRes.json() : [];
  const inviterName = (profileRows && profileRows[0]?.display_name) || 'A friend';

  const appUrl = (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
  const link = `${appUrl}/?invite=${encodeURIComponent(code)}`;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    // No provider configured — the inviter shares the link/code themselves.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailed: false, reason: 'not_configured' }),
    };
  }

  // Atomically reserve a send: verifies ownership + pending + not-expired and
  // enforces a 60s cooldown and a hard cap of 5 emails per invite, so a pending
  // invite can't be replayed to spam the recipient or burn Resend quota. The
  // claim increments the counter only when it returns true, so we do it *after*
  // the provider check and immediately before sending.
  const claimRes = await fetch(`${supabaseUrl}/rest/v1/rpc/claim_invite_email_delivery`, {
    method: 'POST',
    headers: { ...supabaseHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: code, sender_uid: senderUid }),
  });
  if (!claimRes.ok) {
    return { statusCode: 502, body: 'Could not reserve invite delivery' };
  }
  const claimAllowed = await claimRes.json().catch(() => false);
  if (claimAllowed !== true) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailed: false, reason: 'rate_limited' }),
    };
  }

  const fromEmail = process.env.INVITE_FROM_EMAIL || 'LoveWords <onboarding@resend.dev>';
  const safeName = escapeHtml(inviterName);
  const isFriend = invite.mode === 'friend';
  const flavor = isFriend ? 'a game of LoveWords' : 'a game of LoveWords 💕';
  const subject = `${inviterName} invited you to play LoveWords`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#333">
      <h1 style="font-size:22px;margin:0 0 12px">You've been invited to play! 💌</h1>
      <p style="font-size:15px;line-height:1.5"><strong>${safeName}</strong> wants to play ${flavor} with you.</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#E7568C;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 22px;border-radius:12px;display:inline-block">Accept invite &amp; play</a>
      </p>
      <p style="font-size:13px;color:#777;line-height:1.5">Or open the app and enter this code:<br>
        <span style="font-size:20px;font-weight:800;letter-spacing:2px;color:#333">${code.slice(0, 4)}-${code.slice(4)}</span></p>
      <p style="font-size:12px;color:#999;margin-top:20px">If you weren't expecting this, you can ignore this email — the invite expires on its own.</p>
    </div>`;
  const text =
    `${inviterName} invited you to play LoveWords.\n\n` +
    `Accept and play: ${link}\n\n` +
    `Or enter this code in the app: ${code.slice(0, 4)}-${code.slice(4)}\n\n` +
    `If you weren't expecting this, you can ignore this email.`;

  try {
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromEmail, to: inviteeEmail, subject, html, text }),
    });
    if (!sendRes.ok) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailed: false, reason: 'send_failed' }),
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailed: true }),
    };
  } catch {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailed: false, reason: 'send_error' }),
    };
  }
};
