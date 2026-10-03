import {
  computeHeadToHead,
  computePlayerStats,
  formatAverage,
  formatRecord,
  formatWinRate,
} from '../src/engine/stats';
import { Game, GameMode, GameStatus, Move, PlacedTile, Player, PlayerIndex } from '../src/types';

const ME = 'me';
const THEM = 'them';
const OTHER = 'other';

function player(uid: string, score: number, email = `${uid}@example.com`, displayName = uid): Player {
  return { uid, displayName, email, score, rack: [] };
}

function placements(count: number): PlacedTile[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `t${index}`,
    letter: 'A',
    value: 1,
    row: 7,
    col: index,
  }));
}

// v2 play event attributed by seat.
function play(
  playerIndex: PlayerIndex,
  words: Array<[string, number]>,
  tileCount = 3,
  uid = playerIndex === 0 ? ME : THEM
): Move {
  const tiles = placements(tileCount);
  const score = words.reduce((sum, [, wordScore]) => sum + wordScore, 0);
  return {
    uid,
    tiles,
    score,
    timestamp: 0,
    version: 2,
    action: 'play',
    playerIndex,
    placements: tiles.map(({ letter, value, row, col }) => ({ letter, value, row, col })),
    words: words.map(([word, wordScore]) => ({ word, score: wordScore })),
  };
}

function pass(playerIndex: PlayerIndex): Move {
  return { uid: playerIndex === 0 ? ME : THEM, tiles: [], score: 0, timestamp: 0, version: 2, action: 'pass', playerIndex };
}

// Legacy play: attributed by uid, no `words`, no `version`.
function legacyPlay(uid: string, tileCount: number, word?: string, score = 40): Move {
  return { uid, tiles: placements(tileCount), score, timestamp: 0, ...(word ? { word } : {}) };
}

let nextId = 0;
function game(options: {
  myScore?: number;
  theirScore?: number;
  moves?: Move[];
  updatedAt?: number;
  status?: GameStatus;
  mySeat?: PlayerIndex;
  solo?: boolean;
  mode?: GameMode;
  opponentUid?: string;
  opponentName?: string;
}): Game {
  const opponentUid = options.opponentUid ?? THEM;
  const me = player(ME, options.myScore ?? 100);
  const them = options.solo
    ? player(ME, options.theirScore ?? 50, 'solo')
    : player(opponentUid, options.theirScore ?? 50, undefined, options.opponentName ?? opponentUid);
  const players: [Player, Player] = options.mySeat === 1 ? [them, me] : [me, them];
  return {
    id: `game-${nextId++}`,
    players,
    board: [],
    bag: [],
    currentTurn: ME,
    status: options.status ?? 'finished',
    mode: options.mode ?? 'partner',
    moves: options.moves ?? [],
    createdAt: 0,
    updatedAt: options.updatedAt ?? 1000,
  };
}

describe('computePlayerStats', () => {
  it('starts empty with nothing to show', () => {
    const stats = computePlayerStats([], ME);
    expect(stats.record).toEqual({ played: 0, wins: 0, losses: 0, ties: 0, winRate: null });
    expect(stats.me.averageScore).toBeNull();
    expect(stats.me.pointsPerPlay).toBeNull();
    expect(stats.streak).toEqual({ kind: null, length: 0 });
    expect(stats.biggestWin).toBeNull();
    expect(stats.opponents).toEqual([]);
    expect(stats.games).toEqual([]);
  });

  it('counts wins, losses and ties and ignores unfinished and solo games', () => {
    const games = [
      game({ myScore: 100, theirScore: 50, updatedAt: 1 }),
      game({ myScore: 50, theirScore: 100, updatedAt: 2 }),
      game({ myScore: 80, theirScore: 80, updatedAt: 3 }),
      game({ myScore: 300, theirScore: 0, status: 'active', updatedAt: 4 }),
      game({ myScore: 300, theirScore: 0, solo: true, updatedAt: 5 }),
      game({ myScore: 300, theirScore: 0, status: 'declined', updatedAt: 6 }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.record).toEqual({ played: 3, wins: 1, losses: 1, ties: 1, winRate: 1 / 3 });
    expect(stats.games.map((summary) => summary.result)).toEqual(['tie', 'loss', 'win']);
  });

  it('splits the record by partner and friend mode', () => {
    const games = [
      game({ myScore: 100, theirScore: 50, mode: 'partner', updatedAt: 1 }),
      game({ myScore: 10, theirScore: 50, mode: 'friend', updatedAt: 2 }),
      game({ myScore: 100, theirScore: 50, mode: 'friend', updatedAt: 3 }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(formatRecord(stats.byMode.partner)).toBe('1–0–0');
    expect(formatRecord(stats.byMode.friend)).toBe('1–1–0');
  });

  it('reads my score from whichever seat I sit in', () => {
    const games = [
      game({ myScore: 120, theirScore: 90, mySeat: 1, updatedAt: 1 }),
      game({ myScore: 60, theirScore: 90, mySeat: 0, updatedAt: 2 }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.record.wins).toBe(1);
    expect(stats.record.losses).toBe(1);
    expect(stats.me.points).toBe(180);
    expect(stats.me.averageScore).toBe(90);
    expect(stats.me.bestGameScore).toBe(120);
    expect(stats.games[1]).toMatchObject({ myScore: 120, theirScore: 90, margin: 30, result: 'win' });
  });

  it('tracks the current streak, the longest win streak and the biggest win', () => {
    const results: Array<[number, number]> = [
      [100, 50], // win
      [100, 50], // win
      [100, 50], // win
      [30, 50], // loss
      [100, 1], // win (biggest)
      [100, 60], // win
    ];
    const games = results.map(([myScore, theirScore], index) =>
      game({ myScore, theirScore, updatedAt: index + 1 })
    );
    const stats = computePlayerStats(games, ME);
    expect(stats.streak).toEqual({ kind: 'win', length: 2 });
    expect(stats.longestWinStreak).toBe(3);
    expect(stats.biggestWin?.margin).toBe(99);

    const lost = computePlayerStats([...games, game({ myScore: 0, theirScore: 9, updatedAt: 99 })], ME);
    expect(lost.streak).toEqual({ kind: 'loss', length: 1 });
    expect(lost.longestWinStreak).toBe(3);
  });

  it('orders games by finish time, not by the order they were passed in', () => {
    const games = [
      game({ myScore: 10, theirScore: 50, updatedAt: 3 }),
      game({ myScore: 100, theirScore: 50, updatedAt: 1 }),
      game({ myScore: 100, theirScore: 50, updatedAt: 2 }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.streak).toEqual({ kind: 'loss', length: 1 });
    expect(stats.games.map((summary) => summary.finishedAt)).toEqual([3, 2, 1]);
  });

  it('finds my best and longest words, bingos and points per play from my moves only', () => {
    const games = [
      game({
        moves: [
          play(0, [['LOVE', 12]], 4),
          play(1, [['QUIXOTIC', 90]], 7),
          play(0, [['RETAINS', 14], ['SO', 8]], 7),
          pass(0),
        ],
        updatedAt: 1,
      }),
      game({
        moves: [play(0, [['ZAX', 36]], 3), play(1, [['ABCDEFGHIJ', 5]], 7)],
        updatedAt: 2,
      }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.me.bestWord).toEqual({ word: 'ZAX', score: 36, gameId: games[1].id });
    expect(stats.me.longestWord).toEqual({ word: 'RETAINS', score: 14, gameId: games[0].id });
    expect(stats.me.bingos).toBe(1);
    expect(stats.me.plays).toBe(3);
    expect(stats.me.pointsPerPlay).toBeCloseTo((12 + 22 + 36) / 3);
  });

  it('counts legacy moves by uid and only for length', () => {
    const games = [
      game({
        moves: [legacyPlay(ME, 7, 'LONGWORD', 70), legacyPlay(THEM, 3, 'ZZZZZZZZZZ', 99), legacyPlay(ME, 2)],
      }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.me.bestWord).toBeNull();
    expect(stats.me.longestWord).toMatchObject({ word: 'LONGWORD' });
    expect(stats.me.bingos).toBe(1);
    expect(stats.me.plays).toBe(2);
    expect(stats.me.pointsPerPlay).toBe(55);
  });

  it('groups opponents by uid, most played first, with their latest name', () => {
    const games = [
      game({ myScore: 100, theirScore: 50, opponentUid: OTHER, opponentName: 'Old Name', updatedAt: 1 }),
      game({ myScore: 10, theirScore: 50, opponentUid: THEM, updatedAt: 2 }),
      game({ myScore: 100, theirScore: 50, opponentUid: THEM, updatedAt: 3 }),
      game({ myScore: 100, theirScore: 50, opponentUid: OTHER, opponentName: 'New Name', updatedAt: 4 }),
      game({ myScore: 90, theirScore: 90, opponentUid: THEM, updatedAt: 5 }),
    ];
    const stats = computePlayerStats(games, ME);
    expect(stats.opponents.map((opponent) => opponent.uid)).toEqual([THEM, OTHER]);
    expect(stats.opponents[0]).toMatchObject({ lastPlayedAt: 5 });
    expect(formatRecord(stats.opponents[0].record)).toBe('1–1–1');
    expect(stats.opponents[1]).toMatchObject({ displayName: 'New Name', lastPlayedAt: 4 });
    expect(formatRecord(stats.opponents[1].record)).toBe('2–0–0');
  });

  it('breaks opponent ties on who was played most recently', () => {
    const games = [
      game({ opponentUid: THEM, updatedAt: 1 }),
      game({ opponentUid: OTHER, updatedAt: 2 }),
    ];
    expect(computePlayerStats(games, ME).opponents.map((opponent) => opponent.uid)).toEqual([OTHER, THEM]);
  });
});

describe('computeHeadToHead', () => {
  const games = [
    game({ myScore: 312, theirScore: 309, moves: [play(0, [['RETAINS', 14]], 7), play(1, [['HEART', 18]])], updatedAt: 1 }),
    game({ myScore: 100, theirScore: 50, opponentUid: OTHER, updatedAt: 2 }),
    game({ myScore: 241, theirScore: 288, mySeat: 1, moves: [play(1, [['LOVE', 12]], 4, ME), play(0, [['QUIXOTIC', 64]], 7, THEM)], updatedAt: 3 }),
    game({ myScore: 200, theirScore: 200, mode: 'friend', updatedAt: 4 }),
    game({ myScore: 150, theirScore: 300, mode: 'friend', updatedAt: 5 }),
    game({ myScore: 150, theirScore: 300, solo: true, updatedAt: 6 }),
  ];

  it('is null for someone I have not finished a game with, and for myself', () => {
    expect(computeHeadToHead(games, ME, 'stranger')).toBeNull();
    expect(computeHeadToHead(games, ME, ME)).toBeNull();
    expect(computeHeadToHead([], ME, THEM)).toBeNull();
  });

  it('only counts games against that opponent', () => {
    const h2h = computeHeadToHead(games, ME, THEM)!;
    expect(h2h.opponent).toEqual({ uid: THEM, displayName: THEM });
    expect(formatRecord(h2h.record)).toBe('1–2–1');
    expect(h2h.games.map((summary) => summary.finishedAt)).toEqual([5, 4, 3, 1]);
    expect(h2h.mode).toBe('friend');
  });

  it('totals both seats across games whatever seat each sat in', () => {
    const h2h = computeHeadToHead(games, ME, THEM)!;
    expect(h2h.me.points).toBe(312 + 241 + 200 + 150);
    expect(h2h.them.points).toBe(309 + 288 + 200 + 300);
    expect(h2h.me.bestGameScore).toBe(312);
    expect(h2h.them.bestGameScore).toBe(309);
    expect(h2h.me.bestWord).toMatchObject({ word: 'RETAINS', score: 14 });
    expect(h2h.me.longestWord).toMatchObject({ word: 'RETAINS' });
    expect(h2h.them.bestWord).toMatchObject({ word: 'QUIXOTIC', score: 64 });
    expect(h2h.me.bingos).toBe(1);
    expect(h2h.them.bingos).toBe(1);
    expect(h2h.me.pointsPerPlay).toBe(13);
    expect(h2h.them.pointsPerPlay).toBe(41);
  });

  it('reports the streak and the biggest win and loss', () => {
    const h2h = computeHeadToHead(games, ME, THEM)!;
    expect(h2h.streak).toEqual({ kind: 'loss', length: 1 });
    expect(h2h.biggestWin?.margin).toBe(3);
    expect(h2h.biggestLoss?.margin).toBe(-150);
  });

  it('shows the opponent name from the most recent game', () => {
    const renamed = [
      game({ opponentUid: THEM, opponentName: 'Before', updatedAt: 1 }),
      game({ opponentUid: THEM, opponentName: 'After', updatedAt: 2 }),
    ];
    expect(computeHeadToHead(renamed, ME, THEM)?.opponent.displayName).toBe('After');
  });
});

describe('formatting', () => {
  it('formats records, win rates and averages', () => {
    const record = { played: 4, wins: 3, losses: 1, ties: 0, winRate: 0.75 };
    expect(formatRecord(record)).toBe('3–1–0');
    expect(formatWinRate(record)).toBe('75%');
    expect(formatWinRate({ played: 0, wins: 0, losses: 0, ties: 0, winRate: null })).toBe('—');
    expect(formatAverage(null)).toBe('—');
    expect(formatAverage(90)).toBe('90');
    expect(formatAverage(90.04)).toBe('90');
    expect(formatAverage(90.25)).toBe('90.3');
  });
});
