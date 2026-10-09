/**
 * Word requests: players ask for a rejected word to be added, the owner reviews.
 *
 *   POST { action: 'request', word }            any signed-in player
 *   GET                                         reviewers: pending words
 *   POST { action: 'review', word, decision }   reviewers: approve | reject
 *
 * Reviewers are the accounts listed in WORD_ADMIN_EMAILS (comma-separated).
 * Approving a word adds it to `added_words`, which every app and the solver
 * merge into their dictionary. Each pending word shows whether it is in the
 * NASPA Word List when a licensed copy is installed (see lib/nwl.js).
 *
 * Reviewers get a push (and an email when RESEND_API_KEY is set) the first
 * time a word is requested; players who asked get a push when it is added.
 */

const {
  fetchSupabaseUser,
  jsonResponse,
  parseBearer,
  supabaseHeaders,
} = require('./game-analysis-common');
const { addWords, isValidWord } = require('./lib/dictionary');
const { loadAddedWords } = require('./lib/addedWords');
const { loadNwl, nwlStatus } = require('./lib/nwl');
const { pushToUsers, sendEmail, userIdsForEmails } = require('./lib/userPush');

const DEFAULT_APP_URL = 'https://lovewords1234.netlify.app';

// A player can have this many requests waiting at once. Stops one account
// filling the review list; reviewed requests no longer count.
const MAX_PENDING_PER_PLAYER = 20;
const MAX_LISTED_REQUESTS = 2000;
const WORD_PATTERN = /^[A-Z]{2,15}$/;

function serverConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
}

function reviewerEmails(env = process.env) {
  return String(env.WORD_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isReviewer(user, env = process.env) {
  const email = typeof user?.email === 'string' ? user.email.toLowerCase() : '';
  return email !== '' && reviewerEmails(env).includes(email);
}

function normalizeWord(value) {
  const word = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return WORD_PATTERN.test(word) ? word : null;
}

function parseBody(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function countPending(config, userId) {
  const query = new URLSearchParams({
    user_id: `eq.${userId}`,
    status: 'eq.pending',
    select: 'id',
  });
  const response = await fetch(`${config.supabaseUrl}/rest/v1/word_requests?${query}`, {
    method: 'HEAD',
    headers: { ...supabaseHeaders(config.supabaseKey), Prefer: 'count=exact' },
  });
  if (!response.ok) throw new Error(`Supabase request count failed (${response.status})`);
  const total = Number.parseInt(
    String(response.headers.get('content-range') ?? '').split('/')[1],
    10
  );
  return Number.isFinite(total) ? total : 0;
}

async function countPendingForWord(config, word) {
  const query = new URLSearchParams({ word: `eq.${word}`, status: 'eq.pending', select: 'id' });
  const response = await fetch(`${config.supabaseUrl}/rest/v1/word_requests?${query}`, {
    method: 'HEAD',
    headers: { ...supabaseHeaders(config.supabaseKey), Prefer: 'count=exact' },
  });
  if (!response.ok) return 0;
  const total = Number.parseInt(
    String(response.headers.get('content-range') ?? '').split('/')[1],
    10
  );
  return Number.isFinite(total) ? total : 0;
}

// The first request for a word tells the reviewers; later ones only raise the
// count on the review screen, so a popular word doesn't buzz every time.
async function notifyReviewers(config, word) {
  const emails = reviewerEmails();
  if (emails.length === 0) return;
  const appUrl = (process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
  const reviewerIds = await userIdsForEmails(config, emails);
  await Promise.all([
    pushToUsers(
      config,
      reviewerIds,
      '📖 New word request',
      `Someone asked to add ${word}. Review it in Settings → Word requests.`
    ),
    sendEmail(
      emails,
      `Word request: ${word}`,
      `A player asked to add ${word} to the LoveWords dictionary.\n\n` +
        `Review it in the app: Settings → Word requests.\n${appUrl}\n`,
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#2D0A1E">` +
        `<h1 style="font-size:20px;margin:0 0 12px">New word request 📖</h1>` +
        `<p style="font-size:15px;line-height:1.5">A player asked to add <strong>${word}</strong> to the dictionary.</p>` +
        `<p style="font-size:15px;line-height:1.5">Review it in the app under <strong>Settings → Word requests</strong>.</p>` +
        `<p style="margin:24px 0"><a href="${appUrl}" style="background:#A8005F;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 22px;border-radius:12px;display:inline-block">Open LoveWords</a></p>` +
        `</div>`
    ),
  ]);
}

async function handleRequest(config, user, body) {
  const word = normalizeWord(body.word);
  if (!word) {
    return jsonResponse(400, { error: 'Words are 2 to 15 letters, A to Z only.' });
  }

  await loadAddedWords(config.supabaseUrl, config.supabaseKey);
  if (isValidWord(word)) {
    return jsonResponse(200, { status: 'already_valid', word });
  }

  if ((await countPending(config, user.id)) >= MAX_PENDING_PER_PLAYER) {
    return jsonResponse(429, {
      error: 'You have lots of requests waiting already. Try again once they are reviewed.',
    });
  }

  // One row per (word, player): asking twice, or after a rejection, is a no-op.
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/word_requests?on_conflict=word,user_id`,
    {
      method: 'POST',
      headers: {
        ...supabaseHeaders(config.supabaseKey),
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({ word, user_id: user.id }),
    }
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request insert failed (${response.status}): ${detail}`);
  }
  // A duplicate comes back empty; only a new row can be a word's first request.
  const inserted = await response.json().catch(() => []);
  if (Array.isArray(inserted) && inserted.length > 0) {
    if ((await countPendingForWord(config, word)) === 1) await notifyReviewers(config, word);
  }
  return jsonResponse(200, { status: 'requested', word });
}

async function handleList(config) {
  const query = new URLSearchParams({
    status: 'eq.pending',
    select: 'word,created_at',
    order: 'created_at.asc',
    limit: String(MAX_LISTED_REQUESTS),
  });
  const response = await fetch(`${config.supabaseUrl}/rest/v1/word_requests?${query}`, {
    headers: supabaseHeaders(config.supabaseKey),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase request list failed (${response.status}): ${detail}`);
  }
  const rows = await response.json();

  const byWord = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const entry = byWord.get(row.word);
    if (entry) entry.count += 1;
    else byWord.set(row.word, { word: row.word, count: 1, firstRequestedAt: row.created_at });
  }
  // Most-requested first, then oldest first.
  const requests = [...byWord.values()]
    .map((entry) => ({ ...entry, nwl: nwlStatus(entry.word) }))
    .sort((a, b) => b.count - a.count || a.firstRequestedAt.localeCompare(b.firstRequestedAt));

  return jsonResponse(200, { requests, nwlAvailable: loadNwl() !== null });
}

async function handleReview(config, body) {
  const word = normalizeWord(body.word);
  const decision = body.decision;
  if (!word || (decision !== 'approve' && decision !== 'reject')) {
    return jsonResponse(400, { error: 'Send a word and a decision of approve or reject.' });
  }

  if (decision === 'approve') {
    const insert = await fetch(`${config.supabaseUrl}/rest/v1/added_words`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(config.supabaseKey),
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({ word }),
    });
    if (!insert.ok) {
      const detail = await insert.text();
      throw new Error(`Supabase added-word insert failed (${insert.status}): ${detail}`);
    }
    addWords([word]);
  }

  // Who asked, so they can be told once the word is added.
  let requesterIds = [];
  if (decision === 'approve') {
    const who = new URLSearchParams({ word: `eq.${word}`, status: 'eq.pending', select: 'user_id' });
    const response = await fetch(`${config.supabaseUrl}/rest/v1/word_requests?${who}`, {
      headers: supabaseHeaders(config.supabaseKey),
    });
    if (response.ok) {
      const rows = await response.json().catch(() => []);
      requesterIds = Array.isArray(rows) ? rows.map((row) => row.user_id).filter(Boolean) : [];
    }
  }

  const query = new URLSearchParams({ word: `eq.${word}`, status: 'eq.pending' });
  const update = await fetch(`${config.supabaseUrl}/rest/v1/word_requests?${query}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(config.supabaseKey), Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: decision === 'approve' ? 'approved' : 'rejected',
      reviewed_at: new Date().toISOString(),
    }),
  });
  if (!update.ok) {
    const detail = await update.text();
    throw new Error(`Supabase request update failed (${update.status}): ${detail}`);
  }

  if (requesterIds.length > 0) {
    await pushToUsers(
      config,
      requesterIds,
      `✨ ${word} is a word now!`,
      `Your word request was approved. Go play it! 🎉`
    );
  }

  return jsonResponse(200, { status: decision === 'approve' ? 'approved' : 'rejected', word });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' });
  }

  const config = serverConfig();
  if (!config) {
    return jsonResponse(500, { error: 'Word requests are not configured' });
  }

  const accessToken = parseBearer(event.headers);
  if (!accessToken) {
    return jsonResponse(401, { error: 'Missing Authorization header' });
  }

  try {
    const user = await fetchSupabaseUser(config.supabaseUrl, config.supabaseKey, accessToken);
    if (!user) {
      return jsonResponse(401, { error: 'Invalid or expired session' });
    }

    if (event.httpMethod === 'GET') {
      if (!isReviewer(user)) return jsonResponse(403, { error: 'Not a reviewer' });
      return await handleList(config);
    }

    const body = parseBody(event);
    if (body.action === 'request') return await handleRequest(config, user, body);
    if (body.action === 'review') {
      if (!isReviewer(user)) return jsonResponse(403, { error: 'Not a reviewer' });
      return await handleReview(config, body);
    }
    return jsonResponse(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('word-requests error:', error.message);
    return jsonResponse(500, { error: 'Could not handle the word request' });
  }
};

exports.isReviewer = isReviewer;
exports.normalizeWord = normalizeWord;
