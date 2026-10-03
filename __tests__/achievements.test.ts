import {
  Achievement,
  AchievementId,
  ACHIEVEMENT_COUNT,
  computeAchievements,
} from '../src/engine/achievements';
import { Game, GameStatus, Move, PlacedTile, Player, PlayerIndex } from '../src/types';

const ME = 'me';
const THEM = 'them';

function player(uid: string, score: number, email = `${uid}@example.com`): Player {
  return { uid, displayName: uid, email, score, rack: [] };
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

// v2 play event. `rackBefore` is deliberately absent: the server strips it.
function play(
  playerIndex: PlayerIndex,
  words: Array<[string, number]>,
  tileCount = 3
): Move {
  const tiles = placements(tileCount);
  const score = words.reduce((sum, [, wordScore]) => sum + wordScore, 0);
  return {
    uid: playerIndex === 0 ? ME : THEM,
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
}): Game {
  const me = player(ME, options.myScore ?? 100);
  const them = options.solo
    ? player(ME, options.theirScore ?? 50, 'solo')
    : player(THEM, options.theirScore ?? 50);
  const players: [Player, Player] = options.mySeat === 1 ? [them, me] : [me, them];
  return {
    id: `game-${nextId++}`,
    players,
    board: [],
    bag: [],
    currentTurn: ME,
    status: options.status ?? 'finished',
    mode: 'partner',
    moves: options.moves ?? [],
    createdAt: 0,
    updatedAt: options.updatedAt ?? 1000,
  };
}

function byId(achievements: Achievement[], id: AchievementId): Achievement {
  const found = achievements.find((achievement) => achievement.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

function unlockedIds(games: Game[]): AchievementId[] {
  return computeAchievements(games, ME)
    .filter((achievement) => achievement.unlocked)
    .map((achievement) => achievement.id);
}

describe('computeAchievements', () => {
  it('returns the full starter set, all locked, with no games', () => {
    const achievements = computeAchievements([], ME);
    expect(achievements).toHaveLength(ACHIEVEMENT_COUNT);
    expect(ACHIEVEMENT_COUNT).toBe(9);
    expect(achievements.every((achievement) => !achievement.unlocked)).toBe(true);
    expect(achievements.every((achievement) => achievement.unlockedAt === undefined)).toBe(true);
    expect(byId(achievements, 'games_5').progress).toEqual({ current: 0, target: 5 });
    expect(byId(achievements, 'games_25').progress).toEqual({ current: 0, target: 25 });
    expect(byId(achievements, 'first_game').progress).toBeUndefined();
    for (const achievement of achievements) {
      expect(achievement.title).toBeTruthy();
      expect(achievement.description).toBeTruthy();
      expect(achievement.emoji).toBeTruthy();
    }
  });

  describe('which games count', () => {
    it('ignores games that are not finished', () => {
      const games = (['waiting', 'active', 'declined'] as GameStatus[]).map((status) =>
        game({ status, moves: [play(0, [['QUIXOTIC', 80]], 7)] })
      );
      expect(unlockedIds(games)).toEqual([]);
    });

    it('excludes solo games entirely', () => {
      const solo = game({ solo: true, moves: [play(0, [['QUIXOTIC', 80]], 7)] });
      expect(unlockedIds([solo])).toEqual([]);
      expect(byId(computeAchievements([solo], ME), 'games_5').progress?.current).toBe(0);
    });

    it('ignores games the user is not in', () => {
      const other = game({});
      other.players = [player('a', 100), player('b', 50)];
      expect(unlockedIds([other])).toEqual([]);
    });
  });

  describe('game-count badges', () => {
    it('unlocks First Date at the first finished game', () => {
      const achievement = byId(computeAchievements([game({ updatedAt: 42 })], ME), 'first_game');
      expect(achievement.unlocked).toBe(true);
      expect(achievement.unlockedAt).toBe(42);
    });

    it('reports progress and unlocks Going Steady on the 5th game by date', () => {
      // Supplied out of order: unlockedAt must come from the 5th chronologically.
      const games = [5, 3, 1, 4, 2, 6].map((n) => game({ updatedAt: n * 100 }));
      const fourGames = computeAchievements(games.filter((g) => g.updatedAt <= 400), ME);
      expect(byId(fourGames, 'games_5')).toMatchObject({
        unlocked: false,
        progress: { current: 4, target: 5 },
      });

      const all = computeAchievements(games, ME);
      expect(byId(all, 'first_game').unlockedAt).toBe(100);
      expect(byId(all, 'games_5')).toMatchObject({
        unlocked: true,
        unlockedAt: 500,
        progress: { current: 5, target: 5 },
      });
      expect(byId(all, 'games_25')).toMatchObject({
        unlocked: false,
        progress: { current: 6, target: 25 },
      });
    });

    it('unlocks Committed at 25 games and caps progress at the target', () => {
      const games = Array.from({ length: 30 }, (_, n) => game({ updatedAt: n + 1 }));
      expect(byId(computeAchievements(games, ME), 'games_25')).toMatchObject({
        unlocked: true,
        unlockedAt: 25,
        progress: { current: 25, target: 25 },
      });
    });
  });

  describe('win badges', () => {
    it('unlocks Sweet Victory on a win but not a loss', () => {
      expect(unlockedIds([game({ myScore: 50, theirScore: 100 })])).not.toContain('first_win');
      const achievements = computeAchievements(
        [game({ myScore: 50, theirScore: 100, updatedAt: 1 }), game({ myScore: 120, theirScore: 100, updatedAt: 2 })],
        ME
      );
      expect(byId(achievements, 'first_win')).toMatchObject({ unlocked: true, unlockedAt: 2 });
    });

    it('does not count ties as wins', () => {
      const ids = unlockedIds([game({ myScore: 100, theirScore: 100 })]);
      expect(ids).not.toContain('first_win');
      expect(ids).not.toContain('nail_biter');
    });

    it('unlocks Nail-biter only for wins by 5 or fewer', () => {
      expect(unlockedIds([game({ myScore: 106, theirScore: 100 })])).not.toContain('nail_biter');
      expect(unlockedIds([game({ myScore: 105, theirScore: 100 })])).toContain('nail_biter');
      expect(unlockedIds([game({ myScore: 100, theirScore: 103 })])).not.toContain('nail_biter');
    });

    it('reads my score from whichever seat I am in', () => {
      const ids = unlockedIds([game({ mySeat: 1, myScore: 101, theirScore: 99 })]);
      expect(ids).toContain('first_win');
      expect(ids).toContain('nail_biter');
    });
  });

  describe('play badges', () => {
    it('unlocks Bingo for a 7-tile play', () => {
      expect(unlockedIds([game({ moves: [play(0, [['CAT', 5]], 6)] })])).not.toContain('bingo');
      const ids = unlockedIds([game({ moves: [play(0, [['RETAINS', 50]], 7)] })]);
      expect(ids).toContain('bingo');
      expect(ids).not.toContain('double_bingo');
    });

    it('unlocks Double Bingo only for 2 bingos in the same game', () => {
      const split = [
        game({ moves: [play(0, [['RETAINS', 50]], 7)], updatedAt: 1 }),
        game({ moves: [play(0, [['STAINER', 50]], 7)], updatedAt: 2 }),
      ];
      expect(unlockedIds(split)).not.toContain('double_bingo');

      const together = game({
        moves: [play(0, [['RETAINS', 50]], 7), play(1, [['OX', 9]], 2), play(0, [['STAINER', 50]], 7)],
        updatedAt: 3,
      });
      expect(byId(computeAchievements([...split, together], ME), 'double_bingo')).toMatchObject({
        unlocked: true,
        unlockedAt: 3,
      });
    });

    it('unlocks Wordsmith for a single word worth 30+, not a 30+ turn total', () => {
      expect(
        unlockedIds([game({ moves: [play(0, [['ZA', 20], ['AX', 20]])] })])
      ).not.toContain('wordsmith');
      expect(unlockedIds([game({ moves: [play(0, [['QUIZ', 30]])] })])).toContain('wordsmith');
    });

    it('unlocks Long Story for a word of 7+ letters, including cross words', () => {
      expect(unlockedIds([game({ moves: [play(0, [['LOVERS', 12]])] })])).not.toContain('long_story');
      expect(
        unlockedIds([game({ moves: [play(0, [['AT', 2], ['SWEETER', 14]], 2)] })])
      ).toContain('long_story');
    });
  });

  describe('legacy moves', () => {
    it('attributes legacy moves by uid and still detects bingos', () => {
      const ids = unlockedIds([
        game({ moves: [legacyPlay(THEM, 7), legacyPlay(ME, 7), legacyPlay(ME, 7)] }),
      ]);
      expect(ids).toContain('bingo');
      expect(ids).toContain('double_bingo');
    });

    it('skips Wordsmith for legacy moves without words', () => {
      expect(unlockedIds([game({ moves: [legacyPlay(ME, 4, 'QUIZ', 60)] })])).not.toContain('wordsmith');
    });

    it('uses the legacy word for Long Story when present', () => {
      expect(unlockedIds([game({ moves: [legacyPlay(ME, 7, 'RETAINS')] })])).toContain('long_story');
      expect(unlockedIds([game({ moves: [legacyPlay(ME, 7)] })])).not.toContain('long_story');
    });

    it('ignores legacy pass and swap markers', () => {
      const pass: Move = { uid: 'pass', tiles: [], score: 0, timestamp: 0 };
      const swap: Move = { uid: 'swap', tiles: [], score: 0, timestamp: 0 };
      expect(byId(computeAchievements([game({ moves: [pass, swap] })], ME), 'bingo').unlocked).toBe(false);
    });
  });

  describe('attribution', () => {
    it("does not credit the opponent's plays to me", () => {
      const ids = unlockedIds([
        game({
          moves: [
            play(1, [['RETAINS', 50]], 7),
            play(1, [['STAINER', 50]], 7),
            play(1, [['QUIXOTIC', 80]], 7),
          ],
        }),
      ]);
      expect(ids).not.toContain('bingo');
      expect(ids).not.toContain('double_bingo');
      expect(ids).not.toContain('wordsmith');
      expect(ids).not.toContain('long_story');
    });

    it('credits my plays when I am in seat 1', () => {
      const ids = unlockedIds([
        game({ mySeat: 1, moves: [play(0, [['CAT', 5]]), play(1, [['QUIXOTIC', 80]], 7)] }),
      ]);
      expect(ids).toEqual(
        expect.arrayContaining(['bingo', 'wordsmith', 'long_story'])
      );
    });

    it('ignores v2 swap and pass events', () => {
      const swap: Move = {
        uid: ME,
        tiles: [],
        score: 0,
        timestamp: 0,
        version: 2,
        action: 'swap',
        playerIndex: 0,
        returnedTiles: placements(7).map(({ letter, value }) => ({ letter, value })),
      };
      expect(unlockedIds([game({ moves: [swap] })])).not.toContain('bingo');
    });
  });
});
