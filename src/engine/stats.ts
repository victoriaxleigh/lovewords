// Player and head-to-head statistics, computed on the fly from finished games.
//
// Pure on purpose, like achievements.ts: no Supabase or React imports, so the
// same rules run in unit tests and could later run server-side.
import { Game, GameMode, PlayerIndex } from '../types';
import { BINGO_TILE_COUNT, isSoloGame } from './achievements';
import { getMoveAction, getMovePlacements, getMovePlayerIndex } from './gameHistory';

export type GameResult = 'win' | 'loss' | 'tie';

export type WinRecord = {
  played: number;
  wins: number;
  losses: number;
  ties: number;
  // wins / played, or null before any game has been played.
  winRate: number | null;
};

export type BestWord = {
  word: string;
  score: number;
  gameId: string;
};

// One player's totals across a set of games.
export type SeatStats = {
  points: number;
  averageScore: number | null;
  bestGameScore: number;
  bestWord: BestWord | null;
  longestWord: BestWord | null;
  bingos: number;
  plays: number;
  pointsPerPlay: number | null;
};

// One finished game from my seat's point of view.
export type GameSummary = {
  gameId: string;
  finishedAt: number;
  mode: GameMode;
  opponentUid: string;
  opponentName: string;
  myScore: number;
  theirScore: number;
  result: GameResult;
  // myScore - theirScore; positive when I won.
  margin: number;
};

export type Streak = {
  // The result of the latest run of games; null before any game.
  kind: GameResult | null;
  length: number;
};

export type OpponentSummary = {
  uid: string;
  displayName: string;
  record: WinRecord;
  lastPlayedAt: number;
};

export type PlayerStats = {
  record: WinRecord;
  byMode: { partner: WinRecord; friend: WinRecord };
  me: SeatStats;
  streak: Streak;
  longestWinStreak: number;
  biggestWin: GameSummary | null;
  // Newest first.
  games: GameSummary[];
  // Most-played first, then most recent.
  opponents: OpponentSummary[];
};

export type HeadToHeadStats = {
  opponent: { uid: string; displayName: string };
  // Mode of the most recent game together, used to pick partner/friend copy.
  mode: GameMode;
  record: WinRecord;
  me: SeatStats;
  them: SeatStats;
  streak: Streak;
  biggestWin: GameSummary | null;
  biggestLoss: GameSummary | null;
  // Newest first.
  games: GameSummary[];
};

function emptyRecord(): WinRecord {
  return { played: 0, wins: 0, losses: 0, ties: 0, winRate: null };
}

function addResult(record: WinRecord, result: GameResult) {
  record.played++;
  if (result === 'win') record.wins++;
  else if (result === 'loss') record.losses++;
  else record.ties++;
  record.winRate = record.wins / record.played;
}

function otherSeat(seat: PlayerIndex): PlayerIndex {
  return seat === 0 ? 1 : 0;
}

// Finished two-player games I took part in, oldest first. Solo practice games
// are excluded, as they are for achievements.
export function countableGames(games: Game[], myUid: string): Game[] {
  return games
    .filter(
      (game) =>
        game.status === 'finished' &&
        !isSoloGame(game) &&
        game.players.some((player) => player.uid === myUid)
    )
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

function mySeatIn(game: Game, myUid: string): PlayerIndex {
  return game.players.findIndex((player) => player.uid === myUid) as PlayerIndex;
}

export function summarizeGame(game: Game, myUid: string): GameSummary {
  const mySeat = mySeatIn(game, myUid);
  const me = game.players[mySeat];
  const them = game.players[otherSeat(mySeat)];
  const margin = me.score - them.score;
  return {
    gameId: game.id,
    finishedAt: game.updatedAt,
    mode: game.mode,
    opponentUid: them.uid,
    opponentName: them.displayName,
    myScore: me.score,
    theirScore: them.score,
    result: margin > 0 ? 'win' : margin < 0 ? 'loss' : 'tie',
    margin,
  };
}

// Totals for one seat across games (each game's seat is looked up by uid, so the
// same player can sit in either seat from game to game).
function seatStats(games: Game[], uid: string): SeatStats {
  const stats: SeatStats = {
    points: 0,
    averageScore: null,
    bestGameScore: 0,
    bestWord: null,
    longestWord: null,
    bingos: 0,
    plays: 0,
    pointsPerPlay: null,
  };
  let playPoints = 0;

  for (const game of games) {
    const seat = mySeatIn(game, uid);
    const score = game.players[seat].score;
    stats.points += score;
    stats.bestGameScore = Math.max(stats.bestGameScore, score);

    game.moves.forEach((move, moveIndex) => {
      if (getMoveAction(move) !== 'play') return;
      if (getMovePlayerIndex(move, game.players, moveIndex) !== seat) return;

      stats.plays++;
      playPoints += move.score ?? 0;
      if (getMovePlacements(move).length === BINGO_TILE_COUNT) stats.bingos++;

      // Only v2 moves record per-word scores; legacy moves stored a single
      // `word` with no score of its own, so it can only count for length.
      if (Array.isArray(move.words)) {
        for (const word of move.words) {
          if (typeof word.word !== 'string') continue;
          const wordScore = word.score ?? 0;
          if (!stats.bestWord || wordScore > stats.bestWord.score) {
            stats.bestWord = { word: word.word, score: wordScore, gameId: game.id };
          }
          if (!stats.longestWord || word.word.length > stats.longestWord.word.length) {
            stats.longestWord = { word: word.word, score: wordScore, gameId: game.id };
          }
        }
      } else if (typeof move.word === 'string') {
        if (!stats.longestWord || move.word.length > stats.longestWord.word.length) {
          stats.longestWord = { word: move.word, score: move.score ?? 0, gameId: game.id };
        }
      }
    });
  }

  if (games.length > 0) stats.averageScore = stats.points / games.length;
  if (stats.plays > 0) stats.pointsPerPlay = playPoints / stats.plays;
  return stats;
}

// Current run of identical results at the end of a chronological list.
function currentStreak(summaries: GameSummary[]): Streak {
  if (summaries.length === 0) return { kind: null, length: 0 };
  const kind = summaries[summaries.length - 1].result;
  let length = 0;
  for (let index = summaries.length - 1; index >= 0; index--) {
    if (summaries[index].result !== kind) break;
    length++;
  }
  return { kind, length };
}

function longestWinStreak(summaries: GameSummary[]): number {
  let best = 0;
  let run = 0;
  for (const summary of summaries) {
    run = summary.result === 'win' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function biggestOf(summaries: GameSummary[], result: 'win' | 'loss'): GameSummary | null {
  let best: GameSummary | null = null;
  for (const summary of summaries) {
    if (summary.result !== result) continue;
    if (!best || Math.abs(summary.margin) > Math.abs(best.margin)) best = summary;
  }
  return best;
}

export function computePlayerStats(games: Game[], myUid: string): PlayerStats {
  const finished = countableGames(games, myUid);
  const summaries = finished.map((game) => summarizeGame(game, myUid));

  const record = emptyRecord();
  const byMode = { partner: emptyRecord(), friend: emptyRecord() };
  const opponents = new Map<string, OpponentSummary>();

  for (const summary of summaries) {
    addResult(record, summary.result);
    addResult(summary.mode === 'friend' ? byMode.friend : byMode.partner, summary.result);

    let opponent = opponents.get(summary.opponentUid);
    if (!opponent) {
      opponent = {
        uid: summary.opponentUid,
        displayName: summary.opponentName,
        record: emptyRecord(),
        lastPlayedAt: summary.finishedAt,
      };
      opponents.set(summary.opponentUid, opponent);
    }
    addResult(opponent.record, summary.result);
    // Summaries are chronological, so the latest name and date win.
    opponent.displayName = summary.opponentName;
    opponent.lastPlayedAt = summary.finishedAt;
  }

  return {
    record,
    byMode,
    me: seatStats(finished, myUid),
    streak: currentStreak(summaries),
    longestWinStreak: longestWinStreak(summaries),
    biggestWin: biggestOf(summaries, 'win'),
    games: [...summaries].reverse(),
    opponents: [...opponents.values()].sort(
      (a, b) => b.record.played - a.record.played || b.lastPlayedAt - a.lastPlayedAt
    ),
  };
}

export function computeHeadToHead(
  games: Game[],
  myUid: string,
  opponentUid: string
): HeadToHeadStats | null {
  const together = countableGames(games, myUid).filter((game) =>
    game.players.some((player) => player.uid === opponentUid)
  );
  if (together.length === 0 || opponentUid === myUid) return null;

  const summaries = together.map((game) => summarizeGame(game, myUid));
  const record = emptyRecord();
  for (const summary of summaries) addResult(record, summary.result);
  const latest = summaries[summaries.length - 1];

  return {
    opponent: { uid: opponentUid, displayName: latest.opponentName },
    mode: latest.mode,
    record,
    me: seatStats(together, myUid),
    them: seatStats(together, opponentUid),
    streak: currentStreak(summaries),
    biggestWin: biggestOf(summaries, 'win'),
    biggestLoss: biggestOf(summaries, 'loss'),
    games: [...summaries].reverse(),
  };
}

// "12–8–1" style record, in the order wins–losses–ties.
export function formatRecord(record: WinRecord): string {
  return `${record.wins}–${record.losses}–${record.ties}`;
}

export function formatWinRate(record: WinRecord): string {
  if (record.winRate === null) return '—';
  return `${Math.round(record.winRate * 100)}%`;
}

// Averages shown to one decimal only when it isn't a whole number.
export function formatAverage(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
