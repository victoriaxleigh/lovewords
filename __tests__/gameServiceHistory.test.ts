jest.mock('../src/supabase/config', () => ({
  supabase: {
    from: jest.fn(),
    auth: { getSession: jest.fn() },
  },
}));

import { createEmptyBoard } from '../src/engine/board';
import { buildPassEvent } from '../src/engine/gameHistory';
import {
  createGame,
  createSoloGame,
  passSoloTurn,
  passTurn,
  submitMove,
  submitSoloMove,
  swapSoloTiles,
  swapTiles,
} from '../src/supabase/gameService';
import { supabase } from '../src/supabase/config';
import { Game, Move, PlacedTile, Player, Tile } from '../src/types';

const PLAYER_1 = '11111111-1111-4111-8111-111111111111';
const PLAYER_2 = '22222222-2222-4222-8222-222222222222';

function tile(id: string, letter: string, value = 1): Tile {
  return { id, letter, value };
}

function player(uid: string, name: string, rack: Tile[], email = `${name}@example.com`): Player {
  return { uid, displayName: name, email, score: 0, rack };
}

function gameFixture(solo = false): Game {
  const rack1 = [
    tile('p1-c', 'C', 4),
    tile('p1-a', 'A'),
    tile('p1-t', 'T'),
    tile('p1-e', 'E'),
    tile('p1-r', 'R'),
    tile('p1-s', 'S'),
    tile('p1-o', 'O'),
  ];
  const rack2 = [
    tile('p2-d', 'D', 2),
    tile('p2-o', 'O'),
    tile('p2-g', 'G', 3),
    tile('p2-e', 'E'),
    tile('p2-a', 'A'),
    tile('p2-r', 'R'),
    tile('p2-s', 'S'),
  ];
  const bag = Array.from({ length: 20 }, (_, index) =>
    tile(`bag-${index}`, String.fromCharCode(65 + (index % 26)))
  );
  return {
    id: 'game-id',
    players: solo
      ? [
          player(PLAYER_1, 'One', rack1),
          player(PLAYER_1, 'Two', rack2, 'solo'),
        ]
      : [player(PLAYER_1, 'One', rack1), player(PLAYER_2, 'Two', rack2)],
    board: createEmptyBoard(),
    bag,
    currentTurn: PLAYER_1,
    status: 'active',
    mode: 'partner',
    moves: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function catPlacements(game: Game, playerIndex = 0): PlacedTile[] {
  return game.players[playerIndex].rack.slice(0, 3).map((rackTile, index) => ({
    ...rackTile,
    row: 7,
    col: 6 + index,
  }));
}

describe('game service version-2 recording', () => {
  let updatePayload: Record<string, any>;
  let updateMock: jest.Mock;

  beforeEach(() => {
    updatePayload = {};
    const eq = jest.fn().mockResolvedValue({ error: null });
    updateMock = jest.fn((payload) => {
      updatePayload = payload;
      return { eq };
    });
    (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
  });

  test('multiplayer play appends a rich play event', async () => {
    const game = gameFixture();
    const result = await submitMove('game-id', game, PLAYER_1, catPlacements(game));

    expect(result.success).toBe(true);
    expect(updatePayload.current_turn).toBe(PLAYER_2);
    expect(updatePayload.moves).toHaveLength(1);
    expect(updatePayload.moves[0]).toMatchObject({
      version: 2,
      action: 'play',
      playerIndex: 0,
      rackBefore: expect.any(Array),
      placements: expect.any(Array),
      words: [{ word: 'CAT', score: expect.any(Number) }],
      score: expect.any(Number),
      resultingScore: expect.any(Number),
      drawnTiles: expect.any(Array),
      bagCount: 17,
    });
  });

  test('new multiplayer games carry complete-from-creation provenance', async () => {
    const game = gameFixture();
    let insertPayload: Record<string, any> = {};
    const single = jest.fn().mockResolvedValue({ data: { id: 'new-game' }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn((payload) => {
      insertPayload = payload;
      return { select };
    });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await createGame(game.players[0], game.players[1]);

    expect(insertPayload.players).toEqual([
      expect.objectContaining({ uid: PLAYER_1, historyVersion: 2 }),
      expect.objectContaining({ uid: PLAYER_2, historyVersion: 2 }),
    ]);
  });

  test('new solo games mark both sides with complete-from-creation provenance', async () => {
    const game = gameFixture(true);
    let insertPayload: Record<string, any> = {};
    const single = jest.fn().mockResolvedValue({ data: { id: 'new-solo' }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn((payload) => {
      insertPayload = payload;
      return { select };
    });
    (supabase.from as jest.Mock).mockReturnValue({ insert });

    await createSoloGame(game.players[0]);

    expect(insertPayload.players).toEqual([
      expect.objectContaining({ uid: PLAYER_1, historyVersion: 2 }),
      expect.objectContaining({
        uid: PLAYER_1,
        email: 'solo',
        historyVersion: 2,
      }),
    ]);
  });

  test('solo play records the selected side explicitly', async () => {
    const game = gameFixture(true);
    const result = await submitSoloMove('game-id', game, 1, catPlacements(game, 1));

    expect(result.success).toBe(true);
    expect(updatePayload.current_turn).toBeUndefined();
    expect(updatePayload.moves[0]).toMatchObject({
      version: 2,
      action: 'play',
      playerIndex: 1,
      rackBefore: expect.any(Array),
      placements: expect.any(Array),
      words: [{ word: 'DOG', score: expect.any(Number) }],
    });
  });

  test('multiplayer swap appends one event and advances the turn once', async () => {
    const game = gameFixture();
    const result = await swapTiles('game-id', game, PLAYER_1, ['p1-c', 'p1-a']);

    expect(result.success).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updatePayload.current_turn).toBe(PLAYER_2);
    expect(updatePayload.moves).toHaveLength(1);
    expect(updatePayload.moves[0]).toMatchObject({
      version: 2,
      action: 'swap',
      playerIndex: 0,
      rackBefore: expect.any(Array),
      returnedTiles: expect.arrayContaining([
        { letter: 'C', value: 4 },
        { letter: 'A', value: 1 },
      ]),
      drawnTiles: expect.any(Array),
      bagCount: 20,
    });
    expect(JSON.stringify(updatePayload.moves[0].returnedTiles)).not.toContain('p1-c');
  });

  test('solo swap appends the same compact event shape without changing current turn', async () => {
    const game = gameFixture(true);
    const result = await swapSoloTiles('game-id', game, 1, ['p2-d']);

    expect(result.success).toBe(true);
    expect(updatePayload.current_turn).toBeUndefined();
    expect(updatePayload.moves[0]).toMatchObject({
      version: 2,
      action: 'swap',
      playerIndex: 1,
      returnedTiles: [{ letter: 'D', value: 2 }],
      drawnTiles: expect.any(Array),
      bagCount: 20,
    });
    expect(result.updatedGame?.moves).toHaveLength(1);
  });

  test('fourth mixed-format multiplayer pass finishes the game', async () => {
    const game = gameFixture();
    const v2Pass = buildPassEvent({
      uid: PLAYER_2,
      playerIndex: 1,
      rackBefore: game.players[1].rack,
      bagCount: game.bag.length,
    });
    const legacyPass: Move = { uid: 'pass', tiles: [], score: 0, timestamp: 1 };
    game.moves = [legacyPass, v2Pass, legacyPass];

    await passTurn('game-id', game, PLAYER_1);

    expect(updatePayload.status).toBe('finished');
    expect(updatePayload.current_turn).toBe(PLAYER_2);
    expect(updatePayload.moves[3]).toMatchObject({
      version: 2,
      action: 'pass',
      playerIndex: 0,
      rackBefore: expect.any(Array),
      bagCount: 20,
    });
  });

  test('solo pass records the side derived from history and preserves current turn', async () => {
    const game = gameFixture(true);
    game.moves = [
      { uid: 'pass', tiles: [], score: 0, timestamp: 1 },
      { uid: 'pass', tiles: [], score: 0, timestamp: 2 },
      { uid: 'pass', tiles: [], score: 0, timestamp: 3 },
    ];

    await passSoloTurn('game-id', game);

    expect(updatePayload.status).toBe('finished');
    expect(updatePayload.current_turn).toBeUndefined();
    expect(updatePayload.moves[3]).toMatchObject({
      version: 2,
      action: 'pass',
      playerIndex: 1,
      rackBefore: expect.any(Array),
      bagCount: 20,
    });
  });
});
