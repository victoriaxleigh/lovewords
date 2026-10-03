// Achievement rules, computed on the fly from a player's finished games.
//
// Pure on purpose: no Supabase or React imports, so the same rules can run in
// unit tests today and in a server-side (service-role) persister later.
import { Game, PlayerIndex } from '../types';
import { getMoveAction, getMovePlacements, getMovePlayerIndex } from './gameHistory';

export type AchievementId =
  | 'first_game'
  | 'games_5'
  | 'games_25'
  | 'first_win'
  | 'nail_biter'
  | 'bingo'
  | 'double_bingo'
  | 'wordsmith'
  | 'long_story';

export type Achievement = {
  id: AchievementId;
  title: string;
  description: string;
  emoji: string;
  unlocked: boolean;
  unlockedAt?: number;
  progress?: { current: number; target: number };
};

export const BINGO_TILE_COUNT = 7;
export const NAIL_BITER_MARGIN = 5;
export const WORDSMITH_SCORE = 30;
export const LONG_STORY_LENGTH = 7;

// Facts about one finished game, from my seat's point of view.
type GameFacts = {
  won: boolean;
  margin: number;
  bingos: number;
  bestWordScore: number;
  longestWord: number;
};

type Rule = {
  id: AchievementId;
  title: string;
  description: string;
  // Emoji are plain data here so the follow-up pixel-art icons swap in one place.
  emoji: string;
  // Count rules unlock on the Nth qualifying game and report progress.
  target?: number;
  qualifies: (facts: GameFacts) => boolean;
};

const RULES: Rule[] = [
  {
    id: 'first_game',
    title: 'First Date',
    description: 'Finish your first game.',
    emoji: '💕',
    qualifies: () => true,
  },
  {
    id: 'games_5',
    title: 'Going Steady',
    description: 'Finish 5 games.',
    emoji: '💞',
    target: 5,
    qualifies: () => true,
  },
  {
    id: 'games_25',
    title: 'Committed',
    description: 'Finish 25 games.',
    emoji: '💍',
    target: 25,
    qualifies: () => true,
  },
  {
    id: 'first_win',
    title: 'Sweet Victory',
    description: 'Win a game.',
    emoji: '🏆',
    qualifies: (facts) => facts.won,
  },
  {
    id: 'nail_biter',
    title: 'Nail-biter',
    description: `Win a game by ${NAIL_BITER_MARGIN} points or fewer.`,
    emoji: '😅',
    qualifies: (facts) => facts.won && facts.margin <= NAIL_BITER_MARGIN,
  },
  {
    id: 'bingo',
    title: 'Bingo!',
    description: `Play all ${BINGO_TILE_COUNT} tiles in one turn.`,
    emoji: '🎉',
    qualifies: (facts) => facts.bingos >= 1,
  },
  {
    id: 'double_bingo',
    title: 'Double Bingo',
    description: 'Play 2 bingos in one game.',
    emoji: '🔥',
    qualifies: (facts) => facts.bingos >= 2,
  },
  {
    id: 'wordsmith',
    title: 'Wordsmith',
    description: `Score ${WORDSMITH_SCORE}+ points with a single word.`,
    emoji: '✍️',
    qualifies: (facts) => facts.bestWordScore >= WORDSMITH_SCORE,
  },
  {
    id: 'long_story',
    title: 'Long Story',
    description: `Play a word of ${LONG_STORY_LENGTH}+ letters.`,
    emoji: '📜',
    qualifies: (facts) => facts.longestWord >= LONG_STORY_LENGTH,
  },
];

export const ACHIEVEMENT_COUNT = RULES.length;

export function isSoloGame(game: Pick<Game, 'players'>): boolean {
  return game.players.some((player) => player.email === 'solo');
}

function countsTowardAchievements(game: Game, myUid: string): boolean {
  if (game.status !== 'finished' || isSoloGame(game)) return false;
  return game.players.some((player) => player.uid === myUid);
}

function gameFacts(game: Game, mySeat: PlayerIndex): GameFacts {
  const myScore = game.players[mySeat].score;
  const theirScore = game.players[mySeat === 0 ? 1 : 0].score;
  const facts: GameFacts = {
    won: myScore > theirScore,
    margin: myScore - theirScore,
    bingos: 0,
    bestWordScore: 0,
    longestWord: 0,
  };

  game.moves.forEach((move, moveIndex) => {
    if (getMoveAction(move) !== 'play') return;
    if (getMovePlayerIndex(move, game.players, moveIndex) !== mySeat) return;

    if (getMovePlacements(move).length === BINGO_TILE_COUNT) facts.bingos++;

    // Only v2 moves record per-word scores; legacy moves fall back to the
    // single `word` they stored, and never count toward Wordsmith.
    if (Array.isArray(move.words)) {
      for (const word of move.words) {
        facts.bestWordScore = Math.max(facts.bestWordScore, word.score ?? 0);
        facts.longestWord = Math.max(facts.longestWord, word.word?.length ?? 0);
      }
    } else if (typeof move.word === 'string') {
      facts.longestWord = Math.max(facts.longestWord, move.word.length);
    }
  });

  return facts;
}

export function computeAchievements(games: Game[], myUid: string): Achievement[] {
  const finished = games
    .filter((game) => countsTowardAchievements(game, myUid))
    .sort((a, b) => a.updatedAt - b.updatedAt);

  const history = finished.map((game) => {
    const mySeat = game.players.findIndex((player) => player.uid === myUid) as PlayerIndex;
    return { updatedAt: game.updatedAt, facts: gameFacts(game, mySeat) };
  });

  return RULES.map((rule) => {
    const target = rule.target ?? 1;
    let current = 0;
    let unlockedAt: number | undefined;
    for (const entry of history) {
      if (!rule.qualifies(entry.facts)) continue;
      current++;
      if (current === target) unlockedAt = entry.updatedAt;
    }

    const achievement: Achievement = {
      id: rule.id,
      title: rule.title,
      description: rule.description,
      emoji: rule.emoji,
      unlocked: unlockedAt !== undefined,
    };
    if (unlockedAt !== undefined) achievement.unlockedAt = unlockedAt;
    if (rule.target !== undefined) {
      achievement.progress = { current: Math.min(current, target), target };
    }
    return achievement;
  });
}
