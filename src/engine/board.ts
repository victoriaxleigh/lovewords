import { Board, Cell, CellBonus, PlacedTile, Tile } from '../types';

export const BOARD_SIZE = 15;

// LoveWords' own premium-square layout, (row, col) -> bonus.
// TW=triple word, DW=double word, TL=triple letter, DL=double letter.
//
// Design rules (pinned by __tests__/board.test.ts):
//  - mirror-symmetric across both axes and the diagonal, so neither player has a
//    "better side"; 8 TW, 16 DW, 12 TL, 24 DL around the centre START square;
//  - no word premium on the opening row or column, so the first move cannot
//    reach one;
//  - no two triple-word squares share a row or column within 8 squares, and a
//    triple word never shares one with a double word, so there are no 6x-9x
//    lanes.
// The same layout is published to the server in
// netlify/functions/game-analysis-common.js (BOARD_METADATA); a test keeps the
// two in step. Existing games keep the board they were created with.
const BONUS_MAP: Record<string, CellBonus> = {
  // Triple Word
  '1,1': 'TW', '1,13': 'TW', '3,3': 'TW', '3,11': 'TW',
  '11,3': 'TW', '11,11': 'TW', '13,1': 'TW', '13,13': 'TW',
  // Double Word
  '0,2': 'DW', '0,12': 'DW', '2,0': 'DW', '2,4': 'DW',
  '2,10': 'DW', '2,14': 'DW', '4,2': 'DW', '4,12': 'DW',
  '10,2': 'DW', '10,12': 'DW', '12,0': 'DW', '12,4': 'DW',
  '12,10': 'DW', '12,14': 'DW', '14,2': 'DW', '14,12': 'DW',
  // Start square
  '7,7': 'START',
  // Triple Letter
  '2,7': 'TL', '5,6': 'TL', '5,8': 'TL', '6,5': 'TL',
  '6,9': 'TL', '7,2': 'TL', '7,12': 'TL', '8,5': 'TL',
  '8,9': 'TL', '9,6': 'TL', '9,8': 'TL', '12,7': 'TL',
  // Double Letter
  '0,1': 'DL', '0,4': 'DL', '0,10': 'DL', '0,13': 'DL',
  '1,0': 'DL', '1,6': 'DL', '1,8': 'DL', '1,14': 'DL',
  '4,0': 'DL', '4,14': 'DL', '6,1': 'DL', '6,13': 'DL',
  '8,1': 'DL', '8,13': 'DL', '10,0': 'DL', '10,14': 'DL',
  '13,0': 'DL', '13,6': 'DL', '13,8': 'DL', '13,14': 'DL',
  '14,1': 'DL', '14,4': 'DL', '14,10': 'DL', '14,13': 'DL',
};

export function createEmptyBoard(): Board {
  const board: Board = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    board[row] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      board[row][col] = {
        row,
        col,
        tile: null,
        bonus: BONUS_MAP[`${row},${col}`] ?? null,
      };
    }
  }
  return board;
}

export function applyMoveToBoard(board: Board, tiles: PlacedTile[]): Board {
  const newBoard = board.map((row) => row.map((cell) => ({ ...cell })));
  for (const pt of tiles) {
    newBoard[pt.row][pt.col] = {
      ...newBoard[pt.row][pt.col],
      tile: { id: pt.id, letter: pt.letter, value: pt.value, isBlank: pt.isBlank },
    };
  }
  return newBoard;
}

export function getCell(board: Board, row: number, col: number): Cell | null {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
  return board[row][col];
}

export function isValidPlacement(board: Board, tiles: PlacedTile[], isFirstMove: boolean): boolean {
  if (tiles.length === 0) return false;

  // All tiles must be in the same row OR same column
  const rows = new Set(tiles.map((t) => t.row));
  const cols = new Set(tiles.map((t) => t.col));
  if (rows.size > 1 && cols.size > 1) return false;

  // Cells must be empty
  for (const t of tiles) {
    const cell = getCell(board, t.row, t.col);
    if (!cell || cell.tile !== null) return false;
  }

  if (isFirstMove) {
    // Must cover center (7,7)
    return tiles.some((t) => t.row === 7 && t.col === 7);
  }

  // Must be adjacent to an existing tile
  const hasAdjacent = tiles.some((t) =>
    [
      [t.row - 1, t.col],
      [t.row + 1, t.col],
      [t.row, t.col - 1],
      [t.row, t.col + 1],
    ].some(([r, c]) => {
      const cell = getCell(board, r, c);
      return cell !== null && cell.tile !== null;
    })
  );
  return hasAdjacent;
}
