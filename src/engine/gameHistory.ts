import {
  Board,
  Move,
  MoveAction,
  PlacedTile,
  Player,
  PlayerIndex,
  RecordedPlacement,
  RecordedTile,
  ScoredWord,
  Tile,
} from '../types';
import { applyMoveToBoard, BOARD_SIZE, createEmptyBoard } from './board';

type CommonEventInput = {
  uid: string;
  playerIndex: PlayerIndex;
  rackBefore: Tile[];
  bagCount: number;
  timestamp?: number;
};

type PlayEventInput = CommonEventInput & {
  placements: PlacedTile[];
  words: ScoredWord[];
  score: number;
  resultingScore: number;
  drawnTiles: Tile[];
};

type SwapEventInput = CommonEventInput & {
  returnedTiles: Tile[];
  drawnTiles: Tile[];
};

export function recordTile(tile: Pick<Tile, 'letter' | 'value' | 'isBlank'>): RecordedTile {
  const recorded: RecordedTile = {
    letter: tile.letter,
    value: tile.value,
  };
  if (tile.isBlank === true) recorded.isBlank = true;
  return recorded;
}

function recordPlacement(tile: PlacedTile): RecordedPlacement {
  return {
    ...recordTile(tile),
    row: tile.row,
    col: tile.col,
  };
}

export function buildPlayEvent(input: PlayEventInput): Move {
  return {
    uid: input.uid,
    tiles: input.placements,
    score: input.score,
    timestamp: input.timestamp ?? Date.now(),
    version: 2,
    action: 'play',
    playerIndex: input.playerIndex,
    rackBefore: input.rackBefore.map(recordTile),
    placements: input.placements.map(recordPlacement),
    words: input.words.map((word) => ({ word: word.word, score: word.score })),
    resultingScore: input.resultingScore,
    drawnTiles: input.drawnTiles.map(recordTile),
    bagCount: input.bagCount,
  };
}

export function buildSwapEvent(input: SwapEventInput): Move {
  return {
    uid: input.uid,
    tiles: [],
    score: 0,
    timestamp: input.timestamp ?? Date.now(),
    version: 2,
    action: 'swap',
    playerIndex: input.playerIndex,
    rackBefore: input.rackBefore.map(recordTile),
    returnedTiles: input.returnedTiles.map(recordTile),
    drawnTiles: input.drawnTiles.map(recordTile),
    bagCount: input.bagCount,
  };
}

export function buildPassEvent(input: CommonEventInput): Move {
  return {
    uid: input.uid,
    tiles: [],
    score: 0,
    timestamp: input.timestamp ?? Date.now(),
    version: 2,
    action: 'pass',
    playerIndex: input.playerIndex,
    rackBefore: input.rackBefore.map(recordTile),
    bagCount: input.bagCount,
  };
}

export function getMoveAction(move: Move): MoveAction {
  if (move.version === 2 && move.action) return move.action;
  if (move.uid === 'pass') return 'pass';
  if (move.uid === 'swap') return 'swap';
  return 'play';
}

export function getMovePlayerIndex(
  move: Move,
  players?: [Player, Player],
  moveIndex = 0
): PlayerIndex | null {
  if (move.version === 2 && (move.playerIndex === 0 || move.playerIndex === 1)) {
    return move.playerIndex;
  }
  if (!players || move.uid === 'pass' || move.uid === 'swap') return null;
  if (players[0].uid === players[1].uid && move.uid === players[0].uid) {
    return (moveIndex % 2) as PlayerIndex;
  }
  const playerIndex = players.findIndex((player) => player.uid === move.uid);
  return playerIndex === 0 || playerIndex === 1 ? playerIndex : null;
}

export function getMovePlacements(move: Move): RecordedPlacement[] {
  if (move.version === 2 && Array.isArray(move.placements)) {
    return move.placements;
  }
  if (!Array.isArray(move.tiles)) return [];
  return move.tiles.map(recordPlacement);
}

export function hasAnyPlacements(moves: Move[]): boolean {
  return moves.some((move) => getMovePlacements(move).length > 0);
}

export function trailingPassCount(moves: Move[]): number {
  let count = 0;
  for (let index = moves.length - 1; index >= 0; index--) {
    if (getMoveAction(moves[index]) !== 'pass') break;
    count++;
  }
  return count;
}

export function replayBoard(moves: Move[], throughEvent = moves.length): Board {
  const eventCount = Math.max(0, Math.min(moves.length, Math.floor(throughEvent)));
  let board = createEmptyBoard();

  for (let eventIndex = 0; eventIndex < eventCount; eventIndex++) {
    if (getMoveAction(moves[eventIndex]) !== 'play') continue;
    const placements = getMovePlacements(moves[eventIndex])
      .filter(
        (tile) =>
          Number.isInteger(tile.row) &&
          Number.isInteger(tile.col) &&
          tile.row >= 0 &&
          tile.row < BOARD_SIZE &&
          tile.col >= 0 &&
          tile.col < BOARD_SIZE
      )
      .map(
        (tile, placementIndex): PlacedTile => ({
          id: `history-${eventIndex}-${placementIndex}`,
          letter: tile.letter,
          value: tile.value,
          isBlank: tile.isBlank,
          row: tile.row,
          col: tile.col,
        })
      );
    board = applyMoveToBoard(board, placements);
  }

  return board;
}
