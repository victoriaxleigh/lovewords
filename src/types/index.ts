export type Player = {
  uid: string;
  displayName: string;
  email: string;
  score: number;
  rack: Tile[];
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

export type Move = {
  uid: string;
  tiles: PlacedTile[];
  score: number;
  timestamp: number;
  word?: string;
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
  moves: Move[];
  createdAt: number;
  updatedAt: number;
  loveNotes?: LoveNote[];
};
