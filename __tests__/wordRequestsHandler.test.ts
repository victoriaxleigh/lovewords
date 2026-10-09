// Word requests: players ask for a rejected word, reviewers approve or reject.
// Approved words land in added_words and join the solver's dictionary.

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const { handler, isReviewer } = require('../netlify/functions/word-requests');
const { isValidWord } = require('../netlify/functions/lib/dictionary');
const { resetAddedWordsForTests } = require('../netlify/functions/lib/addedWords');
const { loadNwl, resetNwlForTests } = require('../netlify/functions/lib/nwl');

const USER_ID = 'a3f035b6-8b32-4c24-826b-f16e381ed80a';
const ADMIN_EMAIL = 'owner@example.com';

type Call = { url: string; method: string; body?: any; headers?: Record<string, string> };

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function installFetch(opts: {
  email?: string;
  pending?: number;
  addedWords?: string[];
  pendingRows?: { word: string; created_at: string }[];
} = {}) {
  const calls: Call[] = [];
  const fetchMock = jest.fn(async (url: string, init: any = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    if (url.endsWith('/auth/v1/user')) {
      return response(200, { id: USER_ID, email: opts.email ?? 'player@example.com' });
    }
    if (url.includes('/rest/v1/added_words')) {
      if (method === 'GET') return response(200, (opts.addedWords ?? []).map((word) => ({ word })));
      return response(201, null);
    }
    if (url.includes('/rest/v1/word_requests')) {
      if (method === 'HEAD') {
        return response(200, null, { 'content-range': `*/${opts.pending ?? 0}` });
      }
      if (method === 'GET') return response(200, opts.pendingRows ?? []);
      return response(201, null);
    }
    throw new Error(`Unexpected fetch ${method} ${url}`);
  });
  (global as any).fetch = fetchMock;
  return calls;
}

function post(body: unknown) {
  return {
    httpMethod: 'POST',
    headers: { authorization: 'Bearer token' },
    body: JSON.stringify(body),
  };
}

const getList = { httpMethod: 'GET', headers: { authorization: 'Bearer token' } };

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  process.env.WORD_ADMIN_EMAILS = ` ${ADMIN_EMAIL.toUpperCase()} , other@example.com`;
  resetAddedWordsForTests();
  resetNwlForTests();
});

describe('reviewers', () => {
  test('match WORD_ADMIN_EMAILS case-insensitively', () => {
    expect(isReviewer({ email: 'Owner@Example.com' })).toBe(true);
    expect(isReviewer({ email: 'player@example.com' })).toBe(false);
    expect(isReviewer({})).toBe(false);
  });

  test('nobody reviews when the variable is unset', () => {
    expect(isReviewer({ email: ADMIN_EMAIL }, {})).toBe(false);
  });
});

describe('requesting a word', () => {
  test('needs a session', async () => {
    installFetch();
    const res = await handler({ httpMethod: 'POST', headers: {}, body: '{}' });
    expect(res.statusCode).toBe(401);
  });

  test('rejects anything that is not 2-15 letters', async () => {
    installFetch();
    for (const word of ['A', 'DOG1', 'ABCDEFGHIJKLMNOP', '', 42]) {
      const res = await handler(post({ action: 'request', word }));
      expect(res.statusCode).toBe(400);
    }
  });

  test('a word already in the dictionary is not stored', async () => {
    const calls = installFetch();
    const res = await handler(post({ action: 'request', word: 'cat' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'already_valid', word: 'CAT' });
    expect(calls.some((c) => c.url.includes('word_requests'))).toBe(false);
  });

  test('stores a new word once per player', async () => {
    const calls = installFetch();
    const res = await handler(post({ action: 'request', word: ' zxqwv ' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'requested', word: 'ZXQWV' });
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('word_requests'))!;
    expect(insert.url).toContain('on_conflict=word,user_id');
    expect(insert.headers?.Prefer).toContain('ignore-duplicates');
    expect(insert.body).toEqual({ word: 'ZXQWV', user_id: USER_ID });
  });

  test('caps how many requests one player has waiting', async () => {
    installFetch({ pending: 20 });
    const res = await handler(post({ action: 'request', word: 'zxqwv' }));
    expect(res.statusCode).toBe(429);
  });
});

describe('reviewing', () => {
  test('players who are not reviewers cannot list or review', async () => {
    installFetch();
    expect((await handler(getList)).statusCode).toBe(403);
    const res = await handler(post({ action: 'review', word: 'ZXQWV', decision: 'approve' }));
    expect(res.statusCode).toBe(403);
  });

  test('lists pending words grouped, most-requested first, NWL not checked', async () => {
    installFetch({
      email: ADMIN_EMAIL,
      pendingRows: [
        { word: 'AAQZ', created_at: '2026-10-01T00:00:00Z' },
        { word: 'BBQZ', created_at: '2026-10-02T00:00:00Z' },
        { word: 'BBQZ', created_at: '2026-10-03T00:00:00Z' },
      ],
    });
    const res = await handler(getList);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      nwlAvailable: false,
      requests: [
        { word: 'BBQZ', count: 2, firstRequestedAt: '2026-10-02T00:00:00Z', nwl: 'not_checked' },
        { word: 'AAQZ', count: 1, firstRequestedAt: '2026-10-01T00:00:00Z', nwl: 'not_checked' },
      ],
    });
  });

  test('approving adds the word everywhere and closes its requests', async () => {
    const calls = installFetch({ email: ADMIN_EMAIL });
    expect(isValidWord('QWZXV')).toBe(false);
    const res = await handler(post({ action: 'review', word: 'qwzxv', decision: 'approve' }));
    expect(res.statusCode).toBe(200);
    const added = calls.find((c) => c.method === 'POST' && c.url.includes('added_words'))!;
    expect(added.body).toEqual({ word: 'QWZXV' });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toContain('word=eq.QWZXV');
    expect(patch.url).toContain('status=eq.pending');
    expect(patch.body.status).toBe('approved');
    expect(isValidWord('QWZXV')).toBe(true);
  });

  test('rejecting closes the requests without adding the word', async () => {
    const calls = installFetch({ email: ADMIN_EMAIL });
    const res = await handler(post({ action: 'review', word: 'VVQZX', decision: 'reject' }));
    expect(res.statusCode).toBe(200);
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('added_words'))).toBe(false);
    expect(calls.find((c) => c.method === 'PATCH')!.body.status).toBe('rejected');
    expect(isValidWord('VVQZX')).toBe(false);
  });

  test('a review needs a known decision', async () => {
    installFetch({ email: ADMIN_EMAIL });
    const res = await handler(post({ action: 'review', word: 'ZXQWV', decision: 'maybe' }));
    expect(res.statusCode).toBe(400);
  });
});

describe('approved words reach the solver', () => {
  test('words from added_words are merged before checking a request', async () => {
    installFetch({ addedWords: ['XQZPW'] });
    const res = await handler(post({ action: 'request', word: 'xqzpw' }));
    expect(JSON.parse(res.body).status).toBe('already_valid');
  });
});

describe('NWL lookup', () => {
  test('reads a gzipped list when one is installed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwl-'));
    const file = path.join(dir, 'nwl.txt.gz');
    fs.writeFileSync(file, zlib.gzipSync('dox\nrizz\n\nnot a word\n'));
    const words = loadNwl(file);
    expect(words.has('DOX')).toBe(true);
    expect(words.has('RIZZ')).toBe(true);
    expect(words.size).toBe(2);
  });

  test('is null when no list is installed', () => {
    expect(loadNwl(path.join(os.tmpdir(), 'missing-nwl.txt.gz'))).toBeNull();
  });
});
