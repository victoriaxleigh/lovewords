const {
  AnalysisTokenError,
  createAnalysisToken,
  sanitizeGameExport,
  verifyAnalysisToken,
} = require('../netlify/functions/game-analysis-common');

const GAME_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_GAME_ID = 'b3e1d730-70bb-4bc7-9d7a-01cfe13a5a2c';
const SECRET = 'test-only-secret-that-is-long-enough-for-hmac';
const NOW = 1_800_000_000;
const FIXED_RANDOM = () => Buffer.alloc(16, 7);

describe('finished-game analysis token', () => {
  test('signs a token scoped to one game for one hour', () => {
    const { token, claims } = createAnalysisToken(GAME_ID, SECRET, {
      now: NOW,
      randomBytes: FIXED_RANDOM,
    });

    expect(claims.gid).toBe(GAME_ID);
    expect(claims.exp).toBe(NOW + 3600);
    expect(verifyAnalysisToken(token, SECRET, { now: NOW })).toEqual(claims);
    expect(claims.gid).not.toBe(OTHER_GAME_ID);
  });

  test('rejects a tampered token', () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET, {
      now: NOW,
      randomBytes: FIXED_RANDOM,
    });
    const parts = token.split('.');
    const tamperedPayload = `${parts[1].slice(0, -1)}${parts[1].endsWith('A') ? 'B' : 'A'}`;
    const tampered = [parts[0], tamperedPayload, parts[2]].join('.');

    expect(() => verifyAnalysisToken(tampered, SECRET, { now: NOW })).toThrow(
      AnalysisTokenError
    );
  });

  test('rejects an expired token', () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET, {
      now: NOW,
      randomBytes: FIXED_RANDOM,
    });

    expect(() => verifyAnalysisToken(token, SECRET, { now: NOW + 3600 })).toThrow(
      'expired'
    );
  });

  test('rejects malformed tokens and tokens signed with another secret', () => {
    const { token } = createAnalysisToken(GAME_ID, SECRET, {
      now: NOW,
      randomBytes: FIXED_RANDOM,
    });

    expect(() => verifyAnalysisToken('not-a-token', SECRET, { now: NOW })).toThrow(
      'malformed'
    );
    expect(() =>
      verifyAnalysisToken(token, 'another-server-secret', { now: NOW })
    ).toThrow('invalid_signature');
  });
});

describe('finished-game analysis sanitization', () => {
  test('exports only the supported versioned analysis fields', () => {
    const raw = {
      id: GAME_ID,
      player1_uid: 'user-secret-1',
      player2_uid: 'user-secret-2',
      current_turn: 'user-secret-1',
      status: 'finished',
      mode: 'friend',
      created_at: '2026-07-23T12:00:00.000Z',
      updated_at: '2026-07-23T13:00:00.000Z',
      players: [
        {
          uid: 'user-secret-1',
          email: 'one@example.com',
          displayName: 'Ada',
          score: 42,
          rack: [{ id: 'tile-secret-1', letter: 'A', value: 1 }],
        },
        {
          uid: 'user-secret-2',
          email: 'two@example.com',
          displayName: 'Grace',
          score: 37,
          rack: [{ id: 'tile-secret-2', letter: 'B', value: 4, isBlank: true }],
        },
      ],
      board: [[{ tile: { id: 'board-tile-secret', letter: 'Z' } }]],
      bag: [{ id: 'bag-secret', letter: 'C', value: 4 }],
      loveNotes: [{ message: 'private note', emoji: '💕' }],
      moves: [
        {
          uid: 'user-secret-1',
          tiles: [
            {
              id: 'placed-tile-secret',
              letter: 'H',
              value: 3,
              row: 7,
              col: 7,
              isNew: true,
            },
          ],
          score: 6,
          timestamp: 12345,
          word: 'HI',
        },
        { uid: 'pass', tiles: [], score: 0, timestamp: 23456 },
      ],
    };

    const exported = sanitizeGameExport(raw);
    expect(exported).toMatchObject({
      schemaVersion: 1,
      recordingQuality: 'basic',
      gameId: GAME_ID,
      status: 'finished',
      mode: 'friend',
      gameType: 'multiplayer',
      bagCount: 1,
      players: [
        {
          alias: 'player-1',
          displayName: 'Ada',
          finalScore: 42,
          finalRack: [{ letter: 'A', value: 1 }],
        },
        {
          alias: 'player-2',
          displayName: 'Grace',
          finalScore: 37,
          finalRack: [{ letter: 'B', value: 4, isBlank: true }],
        },
      ],
      moves: [
        {
          turn: 1,
          action: 'play',
          player: 'player-1',
          score: 6,
          timestamp: 12345,
          placements: [{ letter: 'H', value: 3, row: 7, col: 7 }],
          word: 'HI',
        },
        {
          turn: 2,
          action: 'pass',
          player: null,
          score: 0,
          timestamp: 23456,
          placements: [],
        },
      ],
      boardMetadata: {
        version: 1,
        size: 15,
        coordinates: { base: 0, origin: 'top-left' },
        bonusSquares: {
          TW: expect.arrayContaining([[0, 0], [7, 14], [14, 14]]),
          START: [[7, 7]],
        },
      },
      rules: {
        version: 1,
        rackSize: 7,
        bingoTileCount: 7,
        bingoBonus: 35,
        consecutivePassLimit: 4,
      },
    });
    expect(exported.moves[0]).not.toHaveProperty('rackBefore');
    expect(exported.moves[0]).not.toHaveProperty('drawnTiles');
    expect(exported.moves[0]).not.toHaveProperty('returnedTiles');
    expect(exported.moves[0]).not.toHaveProperty('words');
    expect(exported.moves[0]).not.toHaveProperty('resultingScore');

    const serialized = JSON.stringify(exported);
    for (const secret of [
      'one@example.com',
      'two@example.com',
      'user-secret-1',
      'user-secret-2',
      'tile-secret-1',
      'tile-secret-2',
      'placed-tile-secret',
      'board-tile-secret',
      'private note',
      '"board"',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('exports complete version-2 play, swap, and pass events as full quality', () => {
    const raw = {
      id: GAME_ID,
      status: 'finished',
      mode: 'partner',
      created_at: '2026-07-23T12:00:00.000Z',
      updated_at: '2026-07-23T13:00:00.000Z',
      players: [
        {
          uid: 'user-secret-1',
          email: 'one@example.com',
          displayName: 'Ada',
          score: 77,
          rack: [],
          historyVersion: 2,
        },
        {
          uid: 'user-secret-2',
          email: 'two@example.com',
          displayName: 'Grace',
          score: 61,
          rack: [],
          historyVersion: 2,
        },
      ],
      bag: [],
      moves: [
        {
          uid: 'user-secret-1',
          tiles: [{ id: 'legacy-ui-id', letter: 'C', value: 4, row: 7, col: 7 }],
          score: 43,
          timestamp: 100,
          version: 2,
          action: 'play',
          playerIndex: 0,
          rackBefore: [
            { letter: 'C', value: 4 },
            { letter: 'A', value: 1 },
          ],
          placements: [{ letter: 'C', value: 4, row: 7, col: 7 }],
          words: [{ word: 'CAT', score: 8 }],
          resultingScore: 43,
          drawnTiles: [{ letter: 'E', value: 1 }],
          bagCount: 50,
        },
        {
          uid: 'user-secret-2',
          tiles: [],
          score: 0,
          timestamp: 200,
          version: 2,
          action: 'swap',
          playerIndex: 1,
          rackBefore: [{ letter: 'Q', value: 10 }],
          returnedTiles: [{ letter: 'Q', value: 10 }],
          drawnTiles: [{ letter: 'S', value: 1 }],
          bagCount: 50,
        },
        {
          uid: 'user-secret-1',
          tiles: [],
          score: 0,
          timestamp: 300,
          version: 2,
          action: 'pass',
          playerIndex: 0,
          rackBefore: [{ letter: 'E', value: 1 }],
          bagCount: 50,
        },
      ],
    };

    const privateEvents = raw.moves.map((event, event_index) => ({
      event_index,
      event,
    }));
    (raw as any).moves = raw.moves.map((event) => {
      const publicEvent = { ...event } as any;
      delete publicEvent.rackBefore;
      delete publicEvent.drawnTiles;
      delete publicEvent.returnedTiles;
      return publicEvent;
    });

    const exported = sanitizeGameExport(raw, privateEvents);

    expect(exported.recordingQuality).toBe('full');
    expect(exported.moves).toEqual([
      {
        turn: 1,
        version: 2,
        action: 'play',
        player: 'player-1',
        score: 43,
        timestamp: 100,
        rackBefore: [
          { letter: 'C', value: 4 },
          { letter: 'A', value: 1 },
        ],
        placements: [{ letter: 'C', value: 4, row: 7, col: 7 }],
        words: [{ word: 'CAT', score: 8 }],
        resultingScore: 43,
        drawnTiles: [{ letter: 'E', value: 1 }],
        bagCount: 50,
      },
      {
        turn: 2,
        version: 2,
        action: 'swap',
        player: 'player-2',
        score: 0,
        timestamp: 200,
        rackBefore: [{ letter: 'Q', value: 10 }],
        placements: [],
        returnedTiles: [{ letter: 'Q', value: 10 }],
        drawnTiles: [{ letter: 'S', value: 1 }],
        bagCount: 50,
      },
      {
        turn: 3,
        version: 2,
        action: 'pass',
        player: 'player-1',
        score: 0,
        timestamp: 300,
        rackBefore: [{ letter: 'E', value: 1 }],
        placements: [],
        bagCount: 50,
      },
    ]);

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('legacy-ui-id');
    expect(serialized).not.toContain('user-secret-1');
    expect(serialized).not.toContain('one@example.com');
    expect(serialized).not.toContain('"board":');
  });

  test('marks mixed history basic while preserving only fields actually recorded', () => {
    const raw = {
      id: GAME_ID,
      status: 'finished',
      players: [
        { uid: 'one', displayName: 'One', rack: [], score: 1 },
        { uid: 'two', displayName: 'Two', rack: [], score: 0 },
      ],
      bag: [],
      moves: [
        {
          uid: 'one',
          tiles: [{ id: 'legacy', letter: 'A', value: 1, row: 7, col: 7 }],
          score: 1,
          timestamp: 1,
        },
        {
          uid: 'two',
          tiles: [],
          score: 0,
          timestamp: 2,
          version: 2,
          action: 'pass',
          playerIndex: 1,
          rackBefore: [{ letter: 'B', value: 4 }],
          bagCount: 10,
        },
      ],
    };

    const privateEvents = [
      {
        event_index: 1,
        event: raw.moves[1],
      },
    ];
    const exported = sanitizeGameExport(raw, privateEvents);

    expect(exported.recordingQuality).toBe('basic');
    expect(exported.moves[0]).not.toHaveProperty('rackBefore');
    expect(exported.moves[0]).not.toHaveProperty('words');
    expect(exported.moves[1]).toMatchObject({
      version: 2,
      player: 'player-2',
      rackBefore: [{ letter: 'B', value: 4 }],
      bagCount: 10,
    });
  });

  test('does not mark an upgrade-era v2-only tail full without creation provenance', () => {
    const fullEvent = {
      uid: 'two',
      tiles: [],
      score: 0,
      timestamp: 2,
      version: 2,
      action: 'pass',
      playerIndex: 1,
      rackBefore: [{ letter: 'B', value: 4 }],
      bagCount: 10,
    };
    const publicEvent = { ...fullEvent } as any;
    delete publicEvent.rackBefore;
    const raw = {
      id: GAME_ID,
      status: 'finished',
      // No historyVersion markers: player one may have made an unrecorded
      // pre-upgrade multiplayer swap before this first visible event.
      players: [
        { uid: 'one', displayName: 'One', rack: [], score: 0 },
        { uid: 'two', displayName: 'Two', rack: [], score: 0 },
      ],
      bag: [],
      moves: [publicEvent],
    };

    const exported = sanitizeGameExport(raw, [{ event_index: 0, event: fullEvent }]);

    expect(exported.recordingQuality).toBe('basic');
    expect(exported.moves[0]).toMatchObject({
      version: 2,
      player: 'player-2',
      rackBefore: [{ letter: 'B', value: 4 }],
    });
  });

  test('requires a matching complete private event for every provenance-marked public event', () => {
    const publicEvent = {
      uid: 'one',
      tiles: [],
      score: 0,
      timestamp: 10,
      version: 2,
      action: 'pass',
      playerIndex: 0,
      bagCount: 5,
    };
    const raw = {
      id: GAME_ID,
      status: 'finished',
      players: [
        {
          uid: 'one',
          displayName: 'One',
          rack: [],
          score: 0,
          historyVersion: 2,
        },
        {
          uid: 'two',
          displayName: 'Two',
          rack: [],
          score: 0,
          historyVersion: 2,
        },
      ],
      bag: [],
      moves: [publicEvent],
    };

    expect(sanitizeGameExport(raw, []).recordingQuality).toBe('basic');
    expect(
      sanitizeGameExport(raw, [
        {
          event_index: 0,
          event: {
            ...publicEvent,
            timestamp: 11,
            rackBefore: [{ letter: 'A', value: 1 }],
          },
        },
      ]).recordingQuality
    ).toBe('basic');
  });
});
