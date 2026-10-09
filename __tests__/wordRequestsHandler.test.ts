// Word requests: players ask for a rejected word, reviewers approve or reject.
// Approved words land in added_words and join the solver's dictionary.

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const mockSendNotification = jest.fn().mockResolvedValue({});
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
}));

const { handler, isReviewer } = require('../netlify/functions/word-requests');
const { isValidWord } = require('../netlify/functions/lib/dictionary');
const { resetAddedWordsForTests } = require('../netlify/functions/lib/addedWords');
const { loadNwl, resetNwlForTests } = require('../netlify/functions/lib/nwl');
const { resetPushForTests } = require('../netlify/functions/lib/userPush');

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

const ADMIN_ID = '6480cd75-0d45-43c0-81a5-a53428879e99';
const REQUESTER_ID = '0b7f4f7e-1111-4c24-826b-f16e381ed80a';

function installFetch(opts: {
  email?: string;
  pending?: number;
  pendingForWord?: number;
  duplicate?: boolean;
  addedWords?: string[];
  pendingRows?: { word: string; created_at: string }[];
  requesters?: string[];
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
        const count = url.includes('user_id=') ? opts.pending ?? 0 : opts.pendingForWord ?? 1;
        return response(200, null, { 'content-range': `*/${count}` });
      }
      if (method === 'GET' && url.includes('select=user_id')) {
        return response(200, (opts.requesters ?? []).map((user_id) => ({ user_id })));
      }
      if (method === 'GET') return response(200, opts.pendingRows ?? []);
      if (method === 'POST') return response(201, opts.duplicate ? [] : [{ id: 'new-row' }]);
      return response(204, null);
    }
    if (url.includes('/rest/v1/profiles?email=')) return response(200, [{ id: ADMIN_ID }]);
    if (url.includes('/rest/v1/profiles?id=')) return response(200, [{ expo_push_token: null }]);
    if (url.includes('/rest/v1/push_subscriptions')) {
      return response(200, [{ endpoint: 'https://push.example/sub', p256dh: 'k', auth: 'a' }]);
    }
    if (url === 'https://api.resend.com/emails') return response(200, { id: 'email' });
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
  process.env.VAPID_PUBLIC_KEY = 'public';
  process.env.VAPID_PRIVATE_KEY = 'private';
  delete process.env.RESEND_API_KEY;
  resetAddedWordsForTests();
  resetNwlForTests();
  resetPushForTests();
  mockSendNotification.mockClear();
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
    expect(insert.headers?.Prefer).toContain('return=representation');
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

describe('notifications', () => {
  const pushTitles = () =>
    mockSendNotification.mock.calls.map(([, payload]) => JSON.parse(payload as string).title);

  test('the first request for a word pushes to reviewers', async () => {
    const calls = installFetch({ pendingForWord: 1 });
    await handler(post({ action: 'request', word: 'zxqwv' }));
    expect(pushTitles()).toEqual(['📖 New word request']);
    const lookup = calls.find((c) => c.url.includes('/rest/v1/profiles?email='))!;
    expect(decodeURIComponent(lookup.url)).toContain('in.("owner@example.com","other@example.com")');
    expect(calls.some((c) => c.url.includes('resend'))).toBe(false);
  });

  test('also emails reviewers when Resend is configured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const calls = installFetch({ pendingForWord: 1 });
    await handler(post({ action: 'request', word: 'zxqwv' }));
    const email = calls.find((c) => c.url === 'https://api.resend.com/emails')!;
    expect(email.body.to).toEqual(['owner@example.com', 'other@example.com']);
    expect(email.body.subject).toBe('Word request: ZXQWV');
  });

  test('later requests for the same word stay quiet', async () => {
    installFetch({ pendingForWord: 2 });
    await handler(post({ action: 'request', word: 'zxqwv' }));
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test('asking twice stays quiet', async () => {
    installFetch({ duplicate: true });
    await handler(post({ action: 'request', word: 'zxqwv' }));
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test('approving tells everyone who asked', async () => {
    installFetch({ email: ADMIN_EMAIL, requesters: [REQUESTER_ID, USER_ID] });
    await handler(post({ action: 'review', word: 'wwqzx', decision: 'approve' }));
    expect(pushTitles()).toEqual(['✨ WWQZX is a word now!', '✨ WWQZX is a word now!']);
  });

  test('rejecting tells nobody', async () => {
    installFetch({ email: ADMIN_EMAIL, requesters: [REQUESTER_ID] });
    await handler(post({ action: 'review', word: 'wwqzz', decision: 'reject' }));
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  test('a push failure never fails the request', async () => {
    mockSendNotification.mockRejectedValueOnce(new Error('push down'));
    installFetch({ pendingForWord: 1 });
    const res = await handler(post({ action: 'request', word: 'zxqwv' }));
    expect(res.statusCode).toBe(200);
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
