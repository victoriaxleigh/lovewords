/**
 * Saved coach notes and the optional per-user review limit.
 *
 * Every function here is best-effort around a table that may not exist yet (a
 * rolling deploy can reach the function before the migration does). A missing
 * table must never break coaching: reads degrade to "no saved note" and writes
 * are skipped, which is exactly how the coach behaved before this existed.
 */

const { supabaseHeaders } = require('../game-analysis-common');

const TABLE = 'game_coach_notes';

/**
 * How many distinct games a player may have coached. Unset, empty or 0 means
 * unlimited, which is today's behaviour. Saved notes never count against it
 * again: re-reading a game you already coached is free.
 */
function reviewLimit(env = process.env) {
  const parsed = Number.parseInt(env.COACH_REVIEW_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function readSavedNote(supabaseUrl, supabaseKey, gameId, userId) {
  const query = new URLSearchParams({
    game_id: `eq.${gameId}`,
    user_id: `eq.${userId}`,
    select: 'analysis,recording_quality,truncated',
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE}?${query}`, {
    headers: supabaseHeaders(supabaseKey),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase coach-note lookup failed (${response.status}): ${detail}`);
  }
  const rows = await response.json();
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row || typeof row.analysis !== 'string' || !row.analysis) return null;
  return {
    analysis: row.analysis,
    recordingQuality: row.recording_quality ?? null,
    truncated: row.truncated === true,
  };
}

/** Number of games this player has a saved coach note for. */
async function countSavedNotes(supabaseUrl, supabaseKey, userId) {
  const query = new URLSearchParams({ user_id: `eq.${userId}`, select: 'game_id' });
  const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE}?${query}`, {
    method: 'HEAD',
    headers: { ...supabaseHeaders(supabaseKey), Prefer: 'count=exact' },
  });
  if (response.status === 404) return 0;
  if (!response.ok) {
    throw new Error(`Supabase coach-note count failed (${response.status})`);
  }
  // PostgREST answers "0-0/42", or "*/42" when the range is empty.
  const total = Number.parseInt(
    String(response.headers.get('content-range') ?? '').split('/')[1],
    10
  );
  return Number.isFinite(total) ? total : 0;
}

/**
 * Save a note. First write wins: if two presses race, the second insert is
 * ignored and both players of the race still see their own generated text.
 * Failures are swallowed on purpose; the player already has their coaching.
 */
async function saveNote(supabaseUrl, supabaseKey, note) {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${TABLE}`, {
      method: 'POST',
      headers: {
        ...supabaseHeaders(supabaseKey),
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        game_id: note.gameId,
        user_id: note.userId,
        analysis: note.analysis,
        recording_quality: note.recordingQuality ?? null,
        truncated: note.truncated === true,
        model: note.model ?? null,
      }),
    });
    if (!response.ok && response.status !== 404) {
      console.error('game-coach: could not save coach note', response.status);
    }
    return response.ok;
  } catch (error) {
    console.error('game-coach: could not save coach note:', error.message);
    return false;
  }
}

module.exports = { countSavedNotes, readSavedNote, reviewLimit, saveNote };
