/**
 * The per-game `game_solutions` cache (issue #25): the pure helpers, the
 * migration/schema contract, and the coach endpoint's use of it. The solve
 * endpoint's hit/miss/failure paths live in `__tests__/solveHandler.test.ts`.
 */
import fs from 'fs';
import path from 'path';

const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }))
);

const {
  forAsker,
  isCacheable,
  toCacheable,
  writeCachedSolve,
} = require('../netlify/functions/lib/solveCache');
const { SOLVER_VERSION, solveGame } = require('../netlify/functions/lib/solver');
const { handler: coachHandler } = require('../netlify/functions/game-coach');
const { resetCooldowns } = require('../netlify/functions/lib/analysisLimits');

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER_ID = 'a3f035b6-8b32-4c24-826b-f16e381ed80a';
const OTHER_USER = '6480cd75-0d45-43c0-81a5-a53428879e99';

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function solveFixture(overrides: Record<string, unknown> = {}) {
  return {
    recordingQuality: 'full',
    askingAlias: 'player-1',
    truncated: false,
    turnsOmitted: 0,
    turnsUnanalyzed: 0,
    players: [
      { alias: 'player-1', displayName: 'Ada', finalScore: 18 },
      { alias: 'player-2', displayName: 'Grace', finalScore: 0 },
    ],
    turns: [
      { turn: 1, player: 'player-1', isAsking: true, status: 'solved', best: [] },
      { turn: 2, player: 'player-2', isAsking: false, status: 'solved', best: [] },
    ],
    ...overrides,
  };
}

describe('solve cache helpers', () => {
  test('a complete solve is cacheable', () => {
    expect(isCacheable(solveFixture())).toBe(true);
  });

  test('a solve whose clock ran out is never cached', () => {
    // Pinning not_analyzed turns onto a game forever would be worse than
    // re-solving: the next request may well finish.
    expect(isCacheable(solveFixture({ truncated: true, turnsUnanalyzed: 3 }))).toBe(false);
    // The clock can also expire after the last rack turn, leaving nothing
    // unanalyzed but `truncated` set with nothing omitted.
    expect(isCacheable(solveFixture({ truncated: true }))).toBe(false);
  });

  test('a solve trimmed only by the turn cap is cacheable', () => {
    // MAX_TURNS is deterministic, so the same game always trims the same way.
    expect(isCacheable(solveFixture({ truncated: true, turnsOmitted: 50 }))).toBe(true);
  });

  test('nothing malformed is cacheable', () => {
    expect(isCacheable(null)).toBe(false);
    expect(isCacheable({ turnsUnanalyzed: 0 })).toBe(false);
  });

  test('the stored form carries no asker, and forAsker restores it per player', () => {
    const stored = toCacheable(solveFixture());
    expect(stored).not.toHaveProperty('askingAlias');
    expect(stored.turns.every((t: object) => !('isAsking' in t))).toBe(true);

    const p2 = forAsker(stored, 'player-2');
    expect(p2.askingAlias).toBe('player-2');
    expect(p2.turns.map((t: { isAsking: boolean }) => t.isAsking)).toEqual([false, true]);
  });

  test('a round trip matches what solveGame returns for each player', () => {
    const exportData = {
      recordingQuality: 'full',
      players: [
        { alias: 'player-1', displayName: 'Ada', finalScore: 18 },
        { alias: 'player-2', displayName: 'Grace', finalScore: 0 },
      ],
      moves: [
        {
          turn: 1,
          action: 'play',
          player: 'player-1',
          score: 18,
          placements: [
            { letter: 'C', value: 4, row: 7, col: 7 },
            { letter: 'A', value: 1, row: 7, col: 8 },
            { letter: 'T', value: 1, row: 7, col: 9 },
          ],
          words: [{ word: 'CAT', score: 18 }],
          rackBefore: 'CATERSL'.split('').map((letter) => ({ letter, value: 1 })),
        },
        { turn: 2, action: 'pass', player: 'player-2', score: 0, placements: [] },
      ],
    };
    const p1 = solveGame(exportData, { askingAlias: 'player-1', budgetMs: 20000 });
    const p2 = solveGame(exportData, { askingAlias: 'player-2', budgetMs: 20000 });
    // Through JSON, as it would be through a jsonb column.
    const stored = JSON.parse(JSON.stringify(toCacheable(p1)));

    expect(forAsker(stored, 'player-1')).toEqual(p1);
    expect(forAsker(stored, 'player-2')).toEqual(p2);
  });

  test('a clock-truncated solve is not written', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const wrote = await writeCachedSolve('https://supabase.example', 'key', GAME_ID, {
      ...solveFixture(),
      truncated: true,
      turnsUnanalyzed: 1,
    });

    expect(wrote).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an opaque secret key travels only in the apikey header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(response(201, null));
    global.fetch = fetchMock;

    await writeCachedSolve('https://supabase.example', 'sb_secret_abc', GAME_ID, solveFixture());

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.apikey).toBe('sb_secret_abc');
    expect(init.headers).not.toHaveProperty('Authorization');
  });
});

describe('game_solutions schema', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'supabase_schema.sql'), 'utf8');
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20261003000100_game_solutions.sql'),
    'utf8'
  );

  test('the migration is forward-only, transactional and idempotent', () => {
    expect(migration).toMatch(/^begin;$/m);
    expect(migration).toMatch(/^commit;$/m);
    expect(migration).toMatch(/create table if not exists public\.game_solutions/i);
    expect(migration).not.toMatch(/drop table/i);
  });

  test.each([
    ['migration', migration, 'public.'],
    ['reference schema', schema, ''],
  ])('the %s defines one row per game, cascading with the game', (_label, sql, prefix) => {
    const games = `${prefix}games`.replace('.', '\\.');
    expect(sql).toMatch(
      new RegExp(`game_id uuid primary key references ${games}\\(id\\) on delete cascade`, 'i')
    );
    expect(sql).toMatch(/solution jsonb not null check \(jsonb_typeof\(solution\) = 'object'\)/i);
    expect(sql).toMatch(/solver_version integer not null check \(solver_version > 0\)/i);
    expect(sql).toMatch(/created_at timestamptz not null default now\(\)/i);
  });

  test.each([
    ['migration', migration, 'public.'],
    ['reference schema', schema, ''],
  ])('the %s keeps the table backend-only', (_label, sql, prefix) => {
    const table = `${prefix}game_solutions`.replace('.', '\\.');
    expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, 'i'));
    expect(sql).toMatch(
      new RegExp(`revoke all on table ${table}\\s+from public, anon, authenticated`, 'i')
    );
    // Upsert needs insert + update; nothing else, and only for the service role.
    expect(sql).toMatch(
      new RegExp(`grant select, insert, update on table ${table} to service_role`, 'i')
    );
    expect(sql).not.toMatch(/create policy[^;]*game_solutions/i);
    expect(sql).not.toMatch(/grant[^;]*game_solutions[^;]*to (anon|authenticated)/i);
  });

  test('SOLVER_VERSION satisfies the column check', () => {
    expect(Number.isInteger(SOLVER_VERSION)).toBe(true);
    expect(SOLVER_VERSION).toBeGreaterThan(0);
  });
});

describe('game-coach and the solve cache', () => {
  let fetchMock: jest.Mock;
  let cacheFetch: jest.Mock;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };

  const FIRST_MOVE = {
    uid: USER_ID,
    score: 18,
    timestamp: 12345,
    version: 2,
    action: 'play',
    playerIndex: 0,
    placements: [
      { letter: 'C', value: 4, row: 7, col: 7 },
      { letter: 'A', value: 1, row: 7, col: 8 },
      { letter: 'T', value: 1, row: 7, col: 9 },
    ],
    words: [{ word: 'CAT', score: 18 }],
    resultingScore: 18,
    bagCount: 80,
  };

  const gameCalls = (uid = USER_ID) =>
    fetchMock
      .mockResolvedValueOnce(response(200, { id: uid }))
      .mockResolvedValueOnce(
        response(200, [
          { id: GAME_ID, player1_uid: USER_ID, player2_uid: OTHER_USER, status: 'finished' },
        ])
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            id: GAME_ID,
            status: 'finished',
            mode: 'partner',
            players: [
              { uid: USER_ID, displayName: 'Ada', score: 18, rack: [], historyVersion: 2 },
              { uid: OTHER_USER, displayName: 'Grace', score: 0, rack: [], historyVersion: 2 },
            ],
            bag: [],
            moves: [FIRST_MOVE],
          },
        ])
      )
      .mockResolvedValueOnce(
        response(200, [
          {
            event_index: 0,
            event: {
              ...FIRST_MOVE,
              rackBefore: 'CATERSL'.split('').map((letter) => ({ letter, value: 1 })),
              drawnTiles: [],
            },
          },
        ])
      );

  const coachEvent = () => ({
    httpMethod: 'POST',
    path: `/api/games/${GAME_ID}/coach`,
    queryStringParameters: { gameId: GAME_ID },
    headers: { authorization: 'Bearer token' },
  });

  const promptSolver = () => {
    const content: string = mockCreate.mock.calls[0][0].messages[0].content;
    const json = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
    return JSON.parse(json).solver;
  };

  const writes = () => cacheFetch.mock.calls.filter(([, init]) => init?.method === 'POST');

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.ANTHROPIC_API_KEY = 'anthropic-key';
    fetchMock = jest.fn();
    cacheFetch = jest.fn((_url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? response(201, null) : response(200, []))
    );
    global.fetch = jest.fn((url: string, init?: unknown) =>
      String(url).includes('/rest/v1/game_solutions')
        ? cacheFetch(url, init)
        : fetchMock(url, init)
    ) as unknown as typeof fetch;
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Turn 1 — CAT (18)' }],
    });
    resetCooldowns();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('a miss solves, fills the cache and coaches from that solve', async () => {
    gameCalls();
    const result = await coachHandler(coachEvent());

    expect(result.statusCode).toBe(200);
    expect(writes()).toHaveLength(1);
    expect(JSON.parse(writes()[0][1].body).solver_version).toBe(SOLVER_VERSION);
    expect(promptSolver().turns[0].best[0].word).toBe('CARTELS');
    expect(promptSolver().turns[0].isAsking).toBe(true);
  });

  test('a hit coaches from the cached row without re-solving', async () => {
    // A sentinel only the cache could have produced: the real solver would say
    // CARTELS for this rack.
    const cached = toCacheable(
      solveFixture({
        turns: [
          {
            turn: 1,
            player: 'player-1',
            status: 'solved',
            best: [{ word: 'FROMCACHE', score: 99, row: 7, col: 3, direction: 'across' }],
          },
        ],
      })
    );
    cacheFetch.mockImplementation(() =>
      Promise.resolve(response(200, [{ solution: cached, solver_version: SOLVER_VERSION }]))
    );

    gameCalls(OTHER_USER);
    const result = await coachHandler(coachEvent());

    expect(result.statusCode).toBe(200);
    expect(writes()).toHaveLength(0);
    const solver = promptSolver();
    expect(solver.turns[0].best[0].word).toBe('FROMCACHE');
    // Stamped for whoever is asking, not whoever filled the cache.
    expect(solver.askingAlias).toBe('player-2');
    expect(solver.turns[0].isAsking).toBe(false);
    expect(mockCreate.mock.calls[0][0].messages[0].content).toMatch(
      /^Coach the player known as "player-2"/
    );
  });

  test('a failing cache degrades to a live solve', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    cacheFetch.mockImplementation(() => Promise.reject(new Error('socket hang up')));

    gameCalls();
    const result = await coachHandler(coachEvent());

    expect(result.statusCode).toBe(200);
    expect(promptSolver().turns[0].best[0].word).toBe('CARTELS');
    errorSpy.mockRestore();
  });
});
