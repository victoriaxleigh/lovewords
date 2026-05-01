import { Board, Cell, CellBonus, PlacedTile, Tile } from '../types';

export const BOARD_SIZE = 15;

// WWF bonus square layout (row, col) -> bonus
// TW=triple word, DW=double word, TL=triple letter, DL=double letter
const BONUS_MAP: Record<string, CellBonus> = {
  // Triple Word
  '0,0': 'TW', '0,7': 'TW', '0,14': 'TW',
  '7,0': 'TW', '7,14': 'TW',
  '14,0': 'TW', '14,7': 'TW', '14,14': 'TW',
  // Double Word / Star
  '7,7': 'START',
  '1,1': 'DW', '2,2': 'DW', '3,3': 'DW', '4,4': 'DW',
  '1,13': 'DW', '2,12': 'DW', '3,11': 'DW', '4,10': 'DW',
  '10,4': 'DW', '11,3': 'DW', '12,2': 'DW', '13,1': 'DW',
  '10,10': 'DW', '11,11': 'DW', '12,12': 'DW', '13,13': 'DW',
  // Triple Letter
  '1,5': 'TL', '1,9': 'TL',
  '5,1': 'TL', '5,5': 'TL', '5,9': 'TL', '5,13': 'TL',
  '9,1': 'TL', '9,5': 'TL', '9,9': 'TL', '9,13': 'TL',
  '13,5': 'TL', '13,9': 'TL',
  // Double Letter
  '0,3': 'DL', '0,11': 'DL',
  '2,6': 'DL', '2,8': 'DL',
  '3,0': 'DL', '3,7': 'DL', '3,14': 'DL',
  '6,2': 'DL', '6,6': 'DL', '6,8': 'DL', '6,12': 'DL',
  '7,3': 'DL', '7,11': 'DL',
  '8,2': 'DL', '8,6': 'DL', '8,8': 'DL', '8,12': 'DL',
  '11,0': 'DL', '11,7': 'DL', '11,14': 'DL',
  '12,6': 'DL', '12,8': 'DL',
  '14,3': 'DL', '14,11': 'DL',
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
      return cell?.tile !== null;
    })
  );
  return hasAdjacent;
}
