const { createAnalysisToken, verifyAnalysisToken } = require(
  '../netlify/functions/game-analysis-common'
);
const { handler: createTokenHandler } = require(
  '../netlify/functions/game-analysis-token'
);
const { handler: exportHandler } = require('../netlify/functions/game-analysis');

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000';
const USER_ID = 'a3f035b6-8b32-4c24-826b-f16e381ed80a';
const OTHER_USER_1 = '6480cd75-0d45-43c0-81a5-a53428879e99';
const OTHER_USER_2 = '554dfa95-2018-4dad-876e-7ba3af31c256';
const SECRET = 'test-only-secret-that-is-long-enough-for-hmac';
const ACCESS_TOKEN = 'supabase-access-token';

type HandlerResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

function tokenEvent(overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'POST',
    path: `/api/games/${GAME_ID}/analysis-token`,
    queryStringParameters: { gameId: GAME_ID },
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      host: 'lovewords.example',
      'x-forwarded-proto': 'https',
    },
    ...overrides,
  };
}

function exportEvent(token?: string, overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'GET',
    path: '/api/game-analysis',
    queryStringParameters: null,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...overrides,
  };
}

function authGame(overrides: Record<string, unknown> = {}) {
  return {
    id: GAME_ID,
    player1_uid: USER_ID,
    player2_uid: OTHER_USER_1,
    status: 'finished',
    ...overrides,
  };
}

function exportGame(overrides: Record<string, unknown> = {}) {
  return {
    id: GAME_ID,
    status: 'finished',
    mode: 'partner',
    created_at: '2026-07-23T12:00:00.000Z',
    updated_at: '2026-07-23T13:00:00.000Z',
    players: [
      {
        uid: USER_ID,
        email: 'ada@example.com',
        displayName: 'Ada',
        score: 15,
        rack: [{ id: 'rack-tile-1', letter: 'A', value: 1 }],
        historyVersion: 2,
      },
      {
        uid: OTHER_USER_1,
        email: 'grace@example.com',
        displayName: 'Grace',
        score: 9,
        rack: [{ id: 'rack-tile-2', letter: 'B', value: 4 }],
        historyVersion: 2,
      },
    ],
    bag: [{ id: 'bag-tile-1', letter: 'C', value: 4 }],
    moves: [
      {
        uid: USER_ID,
        score: 6,
        timestamp: 12345,
        tiles: [{ id: 'move-tile-1', letter: 'H', value: 3, row: 7, col: 7 }],
        version: 2,
        action: 'play',
        playerIndex: 0,
        placements: [{ letter: 'H', value: 3, row: 7, col: 7 }],
        words: [{ word: 'HI', score: 6 }],
        resultingScore: 15,
        bagCount: 1,
      },
    ],
    board: [[{ tile: { id: 'stored-board-tile', letter: 'H' } }]],
    loveNotes: [{ message: 'do not export this' }],
    ...overrides,
  };
}

function privateAnalysisRows() {
  return [
    {
      event_index: 0,
      event: {
        ...exportGame().moves[0],
        rackBefore: [
          { letter: 'H', value: 3 },
          { letter: 'I', value: 1 },
        ],
        drawnTiles: [{ letter: 'E', value: 1 }],
      },
    },
  ];
}

function parseBody(result: HandlerResponse) {
  return JSON.parse(result.body);
}

describe('game-analysis-token handler', () => {
  let fetchMock: jest.Mock;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ANALYSIS_TOKEN_SECRET: process.env.ANALYSIS_TOKEN_SECRET,
    URL: process.env.URL,
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.ANALYSIS_TOKEN_SECRET = SECRET;
    delete process.env.URL;
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('rejects methods other than POST', async () => {
    const result = await createTokenHandler(tokenEvent({ httpMethod: 'GET' }));

    expect(result.statusCode).toBe(405);
    expect(result.headers.Allow).toBe('POST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a malformed game ID before authentication', async () => {
    const result = await createTokenHandler(
      tokenEvent({
        path: '/api/games/not-a-uuid/analysis-token',
        queryStringParameters: { gameId: 'not-a-uuid' },
      })
    );

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).error).toBe('Invalid game ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a missing session', async () => {
    const result = await createTokenHandler(tokenEvent({ headers: {} }));

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toBe('Missing Authorization header');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects an invalid or expired Supabase session', async () => {
    fetchMock.mockResolvedValueOnce(response(401, { error: 'invalid JWT' }));

    const result = await createTokenHandler(tokenEvent());

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toBe('Invalid or expired session');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://supabase.example/auth/v1/user');
  });

  test('rejects a missing game', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { id: USER_ID }))
      .mockResolvedValueOnce(response(200, []));

    const result = await createTokenHandler(tokenEvent());

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toBe('Game not found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('rejects a finished game that does not include the caller', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { id: USER_ID }))
      .mockResolvedValueOnce(
        response(200, [
          authGame({ player1_uid: OTHER_USER_1, player2_uid: OTHER_USER_2 }),
        ])
      );

    const result = await createTokenHandler(tokenEvent());

    expect(result.statusCode).toBe(403);
    expect(parseBody(result).error).toBe('You are not a player in this game');
  });

  test('rejects an unfinished game', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { id: USER_ID }))
      .mockResolvedValueOnce(response(200, [authGame({ status: 'active' })]));

    const result = await createTokenHandler(tokenEvent());

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toBe('Game is not finished');
  });
});

describe('game-analysis handler', () => {
  let fetchMock: jest.Mock;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ANALYSIS_TOKEN_SECRET: process.env.ANALYSIS_TOKEN_SECRET,
    URL: process.env.URL,
  };

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.ANALYSIS_TOKEN_SECRET = SECRET;
    delete process.env.URL;
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('rejects methods other than GET', async () => {
    const result = await exportHandler(exportEvent(undefined, { httpMethod: 'POST' }));

    expect(result.statusCode).toBe(405);
    expect(result.headers.Allow).toBe('GET');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a missing capability token', async () => {
    const result = await exportHandler(exportEvent());

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toBe('Missing analysis token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    ['malformed', 'not-a-capability-token'],
    [
      'signed by another secret',
      createAnalysisToken(GAME_ID, 'another-secret-that-is-also-long-enough').token,
    ],
  ])('rejects an invalid capability token (%s)', async (_label, token) => {
    const result = await exportHandler(exportEvent(token));

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toBe('Invalid analysis token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects an expired capability token', async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const { token } = createAnalysisToken(GAME_ID, SECRET, { now: oneHourAgo });

    const result = await exportHandler(exportEvent(token));

    expect(result.statusCode).toBe(401);
    expect(parseBody(result).error).toBe('Analysis token has expired');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects a token whose scoped game no longer exists', async () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET);
    fetchMock.mockResolvedValueOnce(response(200, []));

    const result = await exportHandler(exportEvent(token));

    expect(result.statusCode).toBe(404);
    expect(parseBody(result).error).toBe('Game not found');
  });

  test('rejects a token whose scoped game is no longer finished', async () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET);
    fetchMock.mockResolvedValueOnce(response(200, [exportGame({ status: 'active' })]));

    const result = await exportHandler(exportEvent(token));

    expect(result.statusCode).toBe(409);
    expect(parseBody(result).error).toBe('Game is not finished');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('falls back to a basic public-history export during a rolling migration', async () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET);
    fetchMock
      .mockResolvedValueOnce(response(200, [exportGame()]))
      .mockResolvedValueOnce(response(404, { message: 'relation not found' }));

    const result = await exportHandler(exportEvent(token));

    expect(result.statusCode).toBe(200);
    expect(parseBody(result).recordingQuality).toBe('basic');
    expect(parseBody(result).moves[0]).not.toHaveProperty('rackBefore');
    expect(parseBody(result).moves[0]).not.toHaveProperty('drawnTiles');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('analysis handler flow', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://supabase.example';
    process.env.SUPABASE_SERVICE_KEY = 'service-role-key';
    process.env.ANALYSIS_TOKEN_SECRET = SECRET;
    delete process.env.URL;
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  test('creates a participant token and uses it for a sanitized export without a session', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { id: USER_ID }))
      .mockResolvedValueOnce(response(200, [authGame()]));

    const tokenResult: HandlerResponse = await createTokenHandler(tokenEvent());
    const tokenBody = parseBody(tokenResult);

    expect(tokenResult.statusCode).toBe(200);
    expect(tokenResult.headers['Content-Type']).toBe(
      'application/json; charset=utf-8'
    );
    expect(tokenResult.headers['Cache-Control']).toBe('private, no-store');
    expect(tokenBody.endpoint).toBe('https://lovewords.example/api/game-analysis');
    expect(tokenBody.curl).toBe(
      `curl -H "Authorization: Bearer ${tokenBody.token}" "${tokenBody.endpoint}"`
    );
    expect(verifyAnalysisToken(tokenBody.token, SECRET).gid).toBe(GAME_ID);

    fetchMock
      .mockResolvedValueOnce(response(200, [exportGame()]))
      .mockResolvedValueOnce(response(200, privateAnalysisRows()));
    const exportResult: HandlerResponse = await exportHandler(
      exportEvent(tokenBody.token)
    );
    const exported = parseBody(exportResult);

    expect(exportResult.statusCode).toBe(200);
    expect(exportResult.headers['Content-Type']).toBe(
      'application/json; charset=utf-8'
    );
    expect(exportResult.headers['Cache-Control']).toBe('private, no-store');
    expect(exported).toMatchObject({
      schemaVersion: 1,
      recordingQuality: 'full',
      gameId: GAME_ID,
      status: 'finished',
      boardMetadata: {
        size: 15,
        bonusSquares: { START: [[7, 7]] },
      },
      rules: {
        rackSize: 7,
        bingoBonus: 35,
      },
      players: [
        { alias: 'player-1', displayName: 'Ada', finalScore: 15 },
        { alias: 'player-2', displayName: 'Grace', finalScore: 9 },
      ],
      moves: [
        {
          version: 2,
          player: 'player-1',
          rackBefore: [
            { letter: 'H', value: 3 },
            { letter: 'I', value: 1 },
          ],
          placements: [{ letter: 'H', row: 7, col: 7 }],
          words: [{ word: 'HI', score: 6 }],
          resultingScore: 15,
          drawnTiles: [{ letter: 'E', value: 1 }],
          bagCount: 1,
        },
      ],
    });

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('ada@example.com');
    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain('rack-tile-1');
    expect(serialized).not.toContain('stored-board-tile');
    expect(serialized).not.toContain('do not export this');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    const exportLookupUrl = fetchMock.mock.calls[2][0].toString();
    expect(exportLookupUrl).toContain(`id=eq.${GAME_ID}`);
    expect(exportLookupUrl).not.toContain('board');
    expect(exportLookupUrl).not.toContain('current_turn');
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
      'Bearer service-role-key'
    );
    const privateLookupUrl = fetchMock.mock.calls[3][0].toString();
    expect(privateLookupUrl).toContain('/rest/v1/game_analysis_events?');
    expect(privateLookupUrl).toContain(`game_id=eq.${GAME_ID}`);
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
      'Bearer service-role-key'
    );
  });
});
