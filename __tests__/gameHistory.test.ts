import { createEmptyBoard } from '../src/engine/board';
import {
  buildPassEvent,
  buildPlayEvent,
  buildSwapEvent,
  getMoveAction,
  getMovePlacements,
  getMovePlayerIndex,
  hasAnyPlacements,
  recordTile,
  replayBoard,
  trailingPassCount,
} from '../src/engine/gameHistory';
import { scoreMove } from '../src/engine/scoring';
import { Move, PlacedTile, Player, Tile } from '../src/types';

function tile(id: string, letter: string, value = 1, isBlank = false): Tile {
  return { id, letter, value, ...(isBlank ? { isBlank: true } : {}) };
}

const rack = [
  tile('rack-1', 'C', 4),
  tile('rack-2', 'A'),
  tile('rack-3', 'T'),
  tile('rack-4', 'E'),
  tile('rack-5', 'R'),
  tile('rack-6', 'S'),
  tile('rack-7', '', 0, true),
];

const placements: PlacedTile[] = rack.map((rackTile, index) => ({
  ...rackTile,
  letter: rackTile.isBlank ? 'N' : rackTile.letter,
  row: 7,
  col: 4 + index,
}));

const players: [Player, Player] = [
  { uid: 'player-one', displayName: 'One', email: 'one@example.com', score: 0, rack },
  { uid: 'player-two', displayName: 'Two', email: 'two@example.com', score: 0, rack: [] },
];

describe('version-2 game history builders', () => {
  test('records a rich play with compact tiles and bingo-inclusive scoring', () => {
    const scored = scoreMove(createEmptyBoard(), placements);
    const event = buildPlayEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      placements,
      words: scored.words,
      score: scored.total,
      resultingScore: scored.total,
      drawnTiles: [tile('drawn-secret', 'O')],
      bagCount: 82,
      timestamp: 12345,
    });

    expect(event).toMatchObject({
      version: 2,
      action: 'play',
      playerIndex: 0,
      words: scored.words,
      score: scored.total,
      resultingScore: scored.total,
      bagCount: 82,
      timestamp: 12345,
    });
    expect(event.score).toBe(scored.words.reduce((sum, word) => sum + word.score, 0) + 35);
    expect(event.rackBefore).toHaveLength(7);
    expect(event.placements).toHaveLength(7);
    expect(event.drawnTiles).toEqual([{ letter: 'O', value: 1 }]);
    expect(JSON.stringify(event.rackBefore)).not.toContain('rack-1');
    expect(JSON.stringify(event.placements)).not.toContain('rack-1');
    expect(JSON.stringify(event.drawnTiles)).not.toContain('drawn-secret');
  });

  test('records swaps and passes with their action-specific compact fields', () => {
    const swap = buildSwapEvent({
      uid: players[1].uid,
      playerIndex: 1,
      rackBefore: rack,
      returnedTiles: [rack[0], rack[6]],
      drawnTiles: [tile('draw-1', 'D', 2), tile('draw-2', 'I')],
      bagCount: 70,
      timestamp: 200,
    });
    const pass = buildPassEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      bagCount: 70,
      timestamp: 300,
    });

    expect(swap).toMatchObject({
      version: 2,
      action: 'swap',
      playerIndex: 1,
      score: 0,
      tiles: [],
      returnedTiles: [
        { letter: 'C', value: 4 },
        { letter: '', value: 0, isBlank: true },
      ],
      drawnTiles: [
        { letter: 'D', value: 2 },
        { letter: 'I', value: 1 },
      ],
      bagCount: 70,
    });
    expect(pass).toMatchObject({
      version: 2,
      action: 'pass',
      playerIndex: 0,
      score: 0,
      tiles: [],
      bagCount: 70,
    });
    expect(swap.placements).toBeUndefined();
    expect(pass.drawnTiles).toBeUndefined();
    expect(pass.returnedTiles).toBeUndefined();
    expect(JSON.stringify(swap.returnedTiles)).not.toContain('rack-');
  });

  test('recordTile never retains a raw tile ID', () => {
    expect(recordTile(tile('super-secret-id', 'Z', 10))).toEqual({
      letter: 'Z',
      value: 10,
    });
  });
});

describe('legacy and version-2 compatibility', () => {
  const legacyPlay: Move = {
    uid: players[0].uid,
    tiles: placements.slice(0, 2),
    score: 10,
    timestamp: 100,
  };
  const legacyPass: Move = { uid: 'pass', tiles: [], score: 0, timestamp: 200 };
  const v2Pass = buildPassEvent({
    uid: players[1].uid,
    playerIndex: 1,
    rackBefore: [],
    bagCount: 20,
    timestamp: 300,
  });

  test('derives actions, placements, and player identity from both formats', () => {
    expect(getMoveAction(legacyPlay)).toBe('play');
    expect(getMoveAction(legacyPass)).toBe('pass');
    expect(getMoveAction(v2Pass)).toBe('pass');
    expect(getMovePlacements(legacyPlay)).toEqual(
      placements.slice(0, 2).map(({ letter, value, isBlank, row, col }) => ({
        letter,
        value,
        ...(isBlank ? { isBlank: true } : {}),
        row,
        col,
      }))
    );
    expect(getMovePlayerIndex(legacyPlay, players, 0)).toBe(0);
    expect(getMovePlayerIndex(legacyPass, players, 1)).toBeNull();
    expect(getMovePlayerIndex(v2Pass, players, 2)).toBe(1);
  });

  test('derives legacy solo identity from deterministic turn order', () => {
    const soloPlayers: [Player, Player] = [
      { ...players[0], uid: 'shared-user' },
      { ...players[1], uid: 'shared-user', email: 'solo' },
    ];
    const legacySoloPlay = { ...legacyPlay, uid: 'shared-user' };

    expect(getMovePlayerIndex(legacySoloPlay, soloPlayers, 0)).toBe(0);
    expect(getMovePlayerIndex(legacySoloPlay, soloPlayers, 1)).toBe(1);
  });

  test('counts mixed legacy and v2 passes and resets on swaps or plays', () => {
    expect(trailingPassCount([legacyPlay, legacyPass, v2Pass])).toBe(2);
    expect(trailingPassCount([legacyPass, v2Pass, legacyPass, v2Pass])).toBe(4);

    const swap = buildSwapEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      returnedTiles: [rack[0]],
      drawnTiles: [rack[1]],
      bagCount: 30,
    });
    expect(trailingPassCount([legacyPass, v2Pass, swap])).toBe(0);
  });

  test('detects the first board play independently of prior passes and swaps', () => {
    const swap = buildSwapEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      returnedTiles: [rack[0]],
      drawnTiles: [rack[1]],
      bagCount: 30,
    });
    expect(hasAnyPlacements([legacyPass, swap])).toBe(false);
    expect(hasAnyPlacements([legacyPass, swap, legacyPlay])).toBe(true);
  });
});

describe('board replay', () => {
  test('replays plays through an intermediate event and ignores swaps and passes', () => {
    const firstPlay = buildPlayEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      placements: placements.slice(0, 2),
      words: [{ word: 'CA', score: 10 }],
      score: 10,
      resultingScore: 10,
      drawnTiles: [],
      bagCount: 50,
    });
    const swap = buildSwapEvent({
      uid: players[1].uid,
      playerIndex: 1,
      rackBefore: rack,
      returnedTiles: [rack[0]],
      drawnTiles: [rack[1]],
      bagCount: 50,
    });
    const pass = buildPassEvent({
      uid: players[0].uid,
      playerIndex: 0,
      rackBefore: rack,
      bagCount: 50,
    });
    const legacySecondPlay: Move = {
      uid: players[1].uid,
      tiles: [{ ...tile('legacy-placement', 'D', 2), row: 6, col: 4 }],
      score: 2,
      timestamp: 400,
    };
    const events = [firstPlay, swap, pass, legacySecondPlay];

    const afterFirst = replayBoard(events, 1);
    expect(afterFirst[7][4].tile?.letter).toBe('C');
    expect(afterFirst[7][5].tile?.letter).toBe('A');
    expect(afterFirst[6][4].tile).toBeNull();

    const afterPass = replayBoard(events, 3);
    expect(afterPass[7][4].tile?.letter).toBe('C');
    expect(afterPass[6][4].tile).toBeNull();

    const complete = replayBoard(events);
    expect(complete[7][4].tile?.letter).toBe('C');
    expect(complete[6][4].tile?.letter).toBe('D');
  });
});
