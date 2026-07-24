export type Player = {
  uid: string;
  displayName: string;
  email: string;
  score: number;
  rack: Tile[];
  historyVersion?: 2;
};

export type Tile = {
  id: string;
  letter: string;
  value: number;
  isBlank?: boolean;
};

export type PlacedTile = Tile & {
  row: number;
  col: number;
  isNew?: boolean; // placed this turn, not yet committed
};

export type CellBonus =
  | 'TW' // triple word
  | 'DW' // double word
  | 'TL' // triple letter
  | 'DL' // double letter
  | 'START'
  | null;

export type Cell = {
  row: number;
  col: number;
  tile: Tile | null;
  bonus: CellBonus;
};

export type Board = Cell[][];

export type GameStatus = 'waiting' | 'active' | 'finished';

// Relationship mode for a game. 'partner' = the romantic experience (love notes,
// 💕 copy); 'friend' = same game with neutral copy ("Messages" instead of "Love
// Notes"). Smack talk stays in both. Solo games default to 'partner'.
export type GameMode = 'partner' | 'friend';

export type RecordedTile = {
  letter: string;
  value: number;
  isBlank?: boolean;
};

export type RecordedPlacement = RecordedTile & {
  row: number;
  col: number;
};

export type ScoredWord = {
  word: string;
  score: number;
};

export type MoveAction = 'play' | 'swap' | 'pass';
export type PlayerIndex = 0 | 1;

export type Move = {
  // Legacy fields remain required because existing UI and stored rows use them.
  uid: string;
  tiles: PlacedTile[];
  score: number;
  timestamp: number;
  word?: string;

  // Analysis-quality fields recorded on all new events.
  version?: 2;
  action?: MoveAction;
  playerIndex?: PlayerIndex;
  rackBefore?: RecordedTile[];
  placements?: RecordedPlacement[];
  words?: ScoredWord[];
  resultingScore?: number;
  drawnTiles?: RecordedTile[];
  returnedTiles?: RecordedTile[];
  bagCount?: number;
};

export type LoveNote = {
  id: string;
  fromUid: string;
  toUid: string;
  message: string;
  emoji: string;
  timestamp: number;
  read: boolean;
};

export type Game = {
  id: string;
  players: [Player, Player];
  board: Board;
  bag: Tile[];
  currentTurn: string; // uid
  status: GameStatus;
  mode: GameMode;
  moves: Move[];
  createdAt: number;
  updatedAt: number;
  loveNotes?: LoveNote[];
};
