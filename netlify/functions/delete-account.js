/**
 * Netlify serverless function — permanently deletes the calling user's
 * account and all associated data. Required for Apple App Store Guideline
 * 5.1.1(v): apps that support account creation must offer in-app deletion.
 *
 * Required env vars (same ones notify.js already uses):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY — service role key (NOT the anon key)
 */

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, body: 'Supabase env vars not set' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
  if (!token) {
    return { statusCode: 401, body: 'Missing Authorization header' };
  }

  // Resolve the uid from the caller's own access token — never trust a uid
  // passed in the request body, or a user could delete someone else's account.
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: 'Invalid or expired session' };
  }
  const { id: uid } = await userRes.json();
  if (!uid) {
    return { statusCode: 401, body: 'Invalid session' };
  }

  const adminHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  async function del(path) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to delete ${path}: ${res.status} ${text}`);
    }
  }

  try {
    // Order matters: delete rows that reference the user before the profile
    // row itself, in case FK constraints don't cascade.
    await del(`love_notes?or=(from_uid.eq.${uid},to_uid.eq.${uid})`);
    await del(`games?or=(player1_uid.eq.${uid},player2_uid.eq.${uid})`);
    await del(`push_subscriptions?user_id=eq.${uid}`);
    await del(`profiles?id=eq.${uid}`);

    const authDeleteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${uid}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    if (!authDeleteRes.ok) {
      const text = await authDeleteRes.text();
      throw new Error(`Failed to delete auth user: ${authDeleteRes.status} ${text}`);
    }

    return { statusCode: 200, body: 'Account deleted' };
  } catch (err) {
    console.error('delete-account error:', err.message);
    return { statusCode: 500, body: 'Account deletion failed. Please try again or contact support.' };
  }
};
