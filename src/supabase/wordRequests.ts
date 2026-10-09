import { supabase } from './config';
import { addWords } from '../engine/dictionary';
import { FUNCTIONS_BASE } from '../utils/apiBase';

// ─── Word requests ───────────────────────────────────────────────────────────
// A player asks for a rejected word to be added; the owner (an account listed
// in WORD_ADMIN_EMAILS on Netlify) approves or rejects it on the Word requests
// screen. Approved words live in `added_words`, which every app merges into
// its dictionary. See netlify/functions/word-requests.js.

export type NwlStatus = 'in_nwl' | 'not_in_nwl' | 'not_checked';

export type PendingWord = {
  word: string;
  count: number;
  firstRequestedAt: string;
  nwl: NwlStatus;
};

export type WordRequestList = { requests: PendingWord[]; nwlAvailable: boolean };

export type RequestWordResult = 'requested' | 'already_valid';

// Expo's web dev server does not run Netlify Functions; ?dev=1 gets canned
// answers so the screens can be reviewed without a backend.
function isDevPreview(): boolean {
  return (
    __DEV__ &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('dev')
  );
}

let devPending: PendingWord[] = [
  { word: 'DOXXER', count: 3, firstRequestedAt: '2026-10-01T10:00:00.000Z', nwl: 'not_checked' },
  { word: 'RIZZY', count: 1, firstRequestedAt: '2026-10-05T10:00:00.000Z', nwl: 'not_checked' },
];

async function callWordRequests(
  init: { method: 'GET' } | { method: 'POST'; body: Record<string, unknown> }
): Promise<{ status: number; body: any }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in again to request words.');

  const response = await fetch(`${FUNCTIONS_BASE}/api/word-requests`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(init.method === 'POST' ? { body: JSON.stringify(init.body) } : {}),
  });
  let body: any = {};
  try {
    body = await response.json();
  } catch {
    // Non-JSON error page; the status code is enough.
  }
  return { status: response.status, body };
}

/** Fetch approved words and merge them into the dictionary. Never throws. */
export async function refreshAddedWords(): Promise<void> {
  try {
    const { data, error } = await supabase.from('added_words').select('word');
    if (error || !Array.isArray(data)) return;
    addWords(data.map((row: { word: string }) => row.word));
  } catch {
    // Offline or table not migrated yet: the built-in dictionary still works.
  }
}

/** Ask for a word to be added. Throws with a player-facing message on failure. */
export async function requestWord(word: string): Promise<RequestWordResult> {
  if (isDevPreview()) return 'requested';
  const { status, body } = await callWordRequests({
    method: 'POST',
    body: { action: 'request', word },
  });
  if (status === 200 && (body.status === 'requested' || body.status === 'already_valid')) {
    return body.status;
  }
  throw new Error(body.error ?? "Couldn't send that request. Try again in a bit.");
}

/** Pending words for reviewers, or null if this account can't review. */
export async function listWordRequests(): Promise<WordRequestList | null> {
  if (isDevPreview()) return { requests: devPending, nwlAvailable: false };
  const { status, body } = await callWordRequests({ method: 'GET' });
  if (status === 403 || status === 401) return null;
  if (status !== 200 || !Array.isArray(body.requests)) {
    throw new Error(body.error ?? "Couldn't load word requests.");
  }
  return { requests: body.requests, nwlAvailable: body.nwlAvailable === true };
}

export async function reviewWord(word: string, decision: 'approve' | 'reject'): Promise<void> {
  if (isDevPreview()) {
    devPending = devPending.filter((entry) => entry.word !== word);
    if (decision === 'approve') addWords([word]);
    return;
  }
  const { status, body } = await callWordRequests({
    method: 'POST',
    body: { action: 'review', word, decision },
  });
  if (status !== 200) throw new Error(body.error ?? "Couldn't save that decision.");
  if (decision === 'approve') addWords([word]);
}
