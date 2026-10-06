// The coach saves one note per (finished game, player), so "Coach me again" is
// free, and can optionally cap how many games one player has coached.

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockCreate(...args) },
  }))
);

const { handler: coachHandler } = require('../netlify/functions/game-coach');
const { resetCooldowns } = require('../netlify/functions/lib/analysisLimits');

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER_ID = 'a3f035b6-8b32-4c24-826b-f16e381ed80a';
const OTHER_USER = '6480cd75-0d45-43c0-81a5-a53428879e99';
const ACCESS_TOKEN = 'supabase-access-token';
const COACH_TEXT = 'Turn 1 — HI (6): solid opener.\nTakeaway: use the premium squares.';

type HandlerResponse = { statusCode: number; headers: Record<string, string>; body: string };

function ok(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function missingTable() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: jest.fn().mockResolvedValue({}),
    text: jest.fn().mockResolvedValue('relation does not exist'),
  };
}

function coachEvent() {
  return {
    httpMethod: 'POST',
    path: `/api/games/${GAME_ID}/coach`,
    queryStringParameters: { gameId: GAME_ID },
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  };
}

function finishedGame() {
  return {
    id: GAME_ID,
    status: 'finished',
    mode: 'partner',
    created_at: '2026-07-23T12:00:00.000Z',
    updated_at: '2026-07-23T13:00:00.000Z',
    players: [
      { uid: USER_ID, displayName: 'Ada', score: 6, rack: [], historyVersion: 2 },
      { uid: OTHER_USER, displayName: 'Grace', score: 0, rack: [], historyVersion: 2 },
    ],
    bag: [],
    moves: [
      {
        uid: USER_ID,
        score: 6,
        timestamp: 1,
        tiles: [{ letter: 'H', value: 3, row: 7, col: 7 }],
        version: 2,
        action: 'play',
        playerIndex: 0,
        placements: [{ letter: 'H', value: 3, row: 7, col: 7 }],
        words: [{ word: 'HI', score: 6 }],
        resultingScore: 6,
        bagCount: 0,
      },
    ],
  };
}

type Notes = {
  saved: { analysis: string; recording_quality: string | null; truncated: boolean } | null;
  count: number;
  tableExists: boolean;
};

/** Routes every Supabase call the coach makes. `notes` is mutated by the test. */
function installFetch(notes: Notes, status = 'finished') {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fetchMock = jest.fn(async (url: string, init: any = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });

    if (url.includes('/auth/v1/user')) return ok({ id: USER_ID });
    if (url.includes('/rest/v1/game_analysis_events')) return ok([]);
    if (url.includes('/rest/v1/game_coach_notes')) {
      if (!notes.tableExists) return missingTable();
      if (method === 'HEAD') return ok([], { 'content-range': `0-0/${notes.count}` });
      if (method === 'POST') return ok([]);
      return ok(notes.saved ? [notes.saved] : []);
    }
    if (url.includes('/rest/v1/games')) {
      const select = new URL(url).searchParams.get('select') ?? '';
      if (select.includes('player1_uid')) {
        return ok([{ id: GAME_ID, player1_uid: USER_ID, player2_uid: OTHER_USER, status }]);
      }
      return ok([finishedGame()]);
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  global.fetch = fetchMock as any;
  return { fetchMock, calls };
}

const parse = (r: HandlerResponse) => JSON.parse(r.body);

describe('game-coach handler', () => {
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    COACH_REVIEW_LIMIT: process.env.COACH_REVIEW_LIMIT,
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.COACH_REVIEW_LIMIT;
    resetCooldowns();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: COACH_TEXT }],
    });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete (process.env as any)[key];
      else (process.env as any)[key] = value;
    }
  });

  test('first press calls the model once and saves the note', async () => {
    const notes: Notes = { saved: null, count: 0, tableExists: true };
    const { calls } = installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(parse(result).analysis).toBe(COACH_TEXT);
    expect(parse(result).cached).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const save = calls.find((c) => c.method === 'POST');
    expect(save?.url).toContain('/rest/v1/game_coach_notes');
    expect(save?.body).toMatchObject({
      game_id: GAME_ID,
      user_id: USER_ID,
      analysis: COACH_TEXT,
      model: 'claude-sonnet-5-5',
    });
  });

  test('a saved note is returned without solving, calling the model, or the cooldown', async () => {
    const notes: Notes = {
      saved: { analysis: 'Saved coaching', recording_quality: 'full', truncated: false },
      count: 1,
      tableExists: true,
    };
    const { calls } = installFetch(notes);

    // Pressed repeatedly within the 10s cooldown: every press is served.
    for (let press = 0; press < 3; press++) {
      const result = (await coachHandler(coachEvent())) as HandlerResponse;
      expect(result.statusCode).toBe(200);
      expect(parse(result)).toMatchObject({
        analysis: 'Saved coaching',
        recordingQuality: 'full',
        truncated: false,
        cached: true,
      });
    }

    expect(mockCreate).not.toHaveBeenCalled();
    // Authorization still runs, but no game export or analysis rows are pulled.
    expect(calls.some((c) => c.url.includes('game_analysis_events'))).toBe(false);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('a second press after a first run reuses the saved note', async () => {
    const notes: Notes = { saved: null, count: 0, tableExists: true };
    installFetch(notes);

    await coachHandler(coachEvent());
    // What the first run wrote is now what the table returns.
    notes.saved = { analysis: COACH_TEXT, recording_quality: 'full', truncated: false };
    const again = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(parse(again).cached).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('does not touch the quota count when no limit is configured', async () => {
    const notes: Notes = { saved: null, count: 999, tableExists: true };
    const { calls } = installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(calls.some((c) => c.method === 'HEAD')).toBe(false);
  });

  test('blocks a new game once COACH_REVIEW_LIMIT games are coached', async () => {
    process.env.COACH_REVIEW_LIMIT = '3';
    const notes: Notes = { saved: null, count: 3, tableExists: true };
    installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(402);
    expect(parse(result)).toMatchObject({ code: 'coach_limit_reached', limit: 3, used: 3 });
    expect(parse(result).error).toContain('3');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('allows a new game while under the limit', async () => {
    process.env.COACH_REVIEW_LIMIT = '3';
    const notes: Notes = { saved: null, count: 2, tableExists: true };
    installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  test('a game already coached is still readable at the limit', async () => {
    process.env.COACH_REVIEW_LIMIT = '1';
    const notes: Notes = {
      saved: { analysis: 'Saved coaching', recording_quality: null, truncated: false },
      count: 1,
      tableExists: true,
    };
    installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(parse(result).cached).toBe(true);
  });

  test('an invalid or zero limit means unlimited', async () => {
    for (const value of ['', '0', '-4', 'lots']) {
      process.env.COACH_REVIEW_LIMIT = value;
      resetCooldowns();
      const { calls } = installFetch({ saved: null, count: 50, tableExists: true });
      const result = (await coachHandler(coachEvent())) as HandlerResponse;
      expect(result.statusCode).toBe(200);
      expect(calls.some((c) => c.method === 'HEAD')).toBe(false);
    }
  });

  test('still coaches when the notes table has not been migrated yet', async () => {
    process.env.COACH_REVIEW_LIMIT = '5';
    const notes: Notes = { saved: null, count: 0, tableExists: false };
    installFetch(notes);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(parse(result).analysis).toBe(COACH_TEXT);
  });

  test('a failed save does not fail the request', async () => {
    const notes: Notes = { saved: null, count: 0, tableExists: true };
    const { fetchMock } = installFetch(notes);
    const route = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init: any = {}) => {
      if ((init.method ?? 'GET') === 'POST') throw new Error('network down');
      return route(url, init);
    });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(200);
    expect(parse(result).analysis).toBe(COACH_TEXT);
    errors.mockRestore();
  });

  test('uses the current Sonnet model and a LoveWords-branded system prompt', async () => {
    installFetch({ saved: null, count: 0, tableExists: true });

    await coachHandler(coachEvent());

    const request = mockCreate.mock.calls[0][0];
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.system).toContain('LoveWords coach');
    expect(request.system).not.toMatch(/words with friends|scrabble|wwf/i);
  });

  test('rejects an unfinished game before any note lookup', async () => {
    const { calls } = installFetch({ saved: null, count: 0, tableExists: true }, 'active');

    const result = (await coachHandler(coachEvent())) as HandlerResponse;

    expect(result.statusCode).toBe(409);
    expect(calls.some((c) => c.url.includes('game_coach_notes'))).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
