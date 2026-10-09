/**
 * Approved word requests (the added_words table), merged into the solver's
 * dictionary so the move-finder and coach accept what players can play.
 *
 * Best-effort like coachNotes.js: a missing table or a failed read leaves the
 * dictionary as it was, which is how the solver behaved before this existed.
 * Results are cached per warm container for a few minutes.
 */

const { supabaseHeaders } = require('../game-analysis-common');
const { addWords } = require('./dictionary');

const REFRESH_MS = 5 * 60 * 1000;
let lastLoadedAt = 0;

async function fetchAddedWords(supabaseUrl, supabaseKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/added_words?select=word`, {
    headers: supabaseHeaders(supabaseKey),
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`Supabase added-words read failed (${response.status})`);
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map((row) => row?.word).filter(Boolean) : [];
}

async function loadAddedWords(supabaseUrl, supabaseKey, now = Date.now()) {
  if (now - lastLoadedAt < REFRESH_MS) return;
  try {
    addWords(await fetchAddedWords(supabaseUrl, supabaseKey));
    lastLoadedAt = now;
  } catch (error) {
    console.error('added-words load failed:', error.message);
  }
}

function resetAddedWordsForTests() {
  lastLoadedAt = 0;
}

module.exports = { fetchAddedWords, loadAddedWords, resetAddedWordsForTests };
