import { createEmptyBoard, applyMoveToBoard, isValidPlacement, getCell, BOARD_SIZE } from '../src/engine/board';
import { PlacedTile } from '../src/types';

// Helper to make a placed tile easily
function makeTile(id: string, letter: string, row: number, col: number): PlacedTile {
  return { id, letter, value: 1, row, col, isNew: true };
}

describe('createEmptyBoard', () => {
  test('creates a 15x15 board', () => {
    const board = createEmptyBoard();
    expect(board).toHaveLength(BOARD_SIZE);
    board.forEach((row) => expect(row).toHaveLength(BOARD_SIZE));
  });

  test('all cells start with no tile', () => {
    const board = createEmptyBoard();
    board.forEach((row) =>
      row.forEach((cell) => expect(cell.tile).toBeNull())
    );
  });

  test('center square (7,7) is the START bonus', () => {
    const board = createEmptyBoard();
    expect(board[7][7].bonus).toBe('START');
  });

  test('corner (0,0) is a triple word square', () => {
    const board = createEmptyBoard();
    expect(board[0][0].bonus).toBe('TW');
  });

  test('(0,3) is a double letter square', () => {
    const board = createEmptyBoard();
    expect(board[0][3].bonus).toBe('DL');
  });

  test('(1,5) is a triple letter square', () => {
    const board = createEmptyBoard();
    expect(board[1][5].bonus).toBe('TL');
  });

  test('each cell has correct row and col', () => {
    const board = createEmptyBoard();
    board.forEach((row, r) =>
      row.forEach((cell, c) => {
        expect(cell.row).toBe(r);
        expect(cell.col).toBe(c);
      })
    );
  });
});

describe('getCell', () => {
  test('returns cell for valid coordinates', () => {
    const board = createEmptyBoard();
    const cell = getCell(board, 7, 7);
    expect(cell).not.toBeNull();
    expect(cell?.row).toBe(7);
    expect(cell?.col).toBe(7);
  });

  test('returns null for out-of-bounds coordinates', () => {
    const board = createEmptyBoard();
    expect(getCell(board, -1, 0)).toBeNull();
    expect(getCell(board, 0, -1)).toBeNull();
    expect(getCell(board, 15, 0)).toBeNull();
    expect(getCell(board, 0, 15)).toBeNull();
  });
});

describe('applyMoveToBoard', () => {
  test('places tiles on the board', () => {
    const board = createEmptyBoard();
    const tiles = [makeTile('t1', 'A', 7, 7), makeTile('t2', 'T', 7, 8)];
    const newBoard = applyMoveToBoard(board, tiles);
    expect(newBoard[7][7].tile?.letter).toBe('A');
    expect(newBoard[7][8].tile?.letter).toBe('T');
  });

  test('does not mutate the original board', () => {
    const board = createEmptyBoard();
    applyMoveToBoard(board, [makeTile('t1', 'A', 7, 7)]);
    expect(board[7][7].tile).toBeNull();
  });

  test('preserves existing tiles when adding new ones', () => {
    const board = createEmptyBoard();
    const board2 = applyMoveToBoard(board, [makeTile('t1', 'A', 7, 7)]);
    const board3 = applyMoveToBoard(board2, [makeTile('t2', 'T', 7, 8)]);
    expect(board3[7][7].tile?.letter).toBe('A');
    expect(board3[7][8].tile?.letter).toBe('T');
  });
});

describe('isValidPlacement', () => {
  test('first move must cover center (7,7)', () => {
    const board = createEmptyBoard();
    const validTiles = [makeTile('t1', 'A', 7, 7), makeTile('t2', 'T', 7, 8)];
    const invalidTiles = [makeTile('t1', 'A', 5, 5), makeTile('t2', 'T', 5, 6)];
    expect(isValidPlacement(board, validTiles, true)).toBe(true);
    expect(isValidPlacement(board, invalidTiles, true)).toBe(false);
  });

  test('rejects empty tile placement', () => {
    const board = createEmptyBoard();
    expect(isValidPlacement(board, [], true)).toBe(false);
    expect(isValidPlacement(board, [], false)).toBe(false);
  });

  test('rejects tiles not in a single row or column', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'A', 7, 7),
      makeTile('t2', 'T', 8, 8), // different row AND column
    ];
    expect(isValidPlacement(board, tiles, true)).toBe(false);
  });

  test('accepts tiles in same row', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'A', 7, 6),
      makeTile('t2', 'T', 7, 7),
      makeTile('t3', 'E', 7, 8),
    ];
    expect(isValidPlacement(board, tiles, true)).toBe(true);
  });

  test('accepts tiles in same column', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'A', 6, 7),
      makeTile('t2', 'T', 7, 7),
      makeTile('t3', 'E', 8, 7),
    ];
    expect(isValidPlacement(board, tiles, true)).toBe(true);
  });

  test('after first move, tiles must be adjacent to existing tiles', () => {
    const board = createEmptyBoard();
    // Place AT on center
    const board2 = applyMoveToBoard(board, [
      makeTile('t1', 'A', 7, 7),
      makeTile('t2', 'T', 7, 8),
    ]);
    // Adjacent placement — valid (7,9 is empty and directly next to T at 7,8)
    const adjacent = [makeTile('t4', 'E', 7, 9)];
    // Isolated placement — invalid (far from any existing tile)
    const isolated = [makeTile('t5', 'E', 0, 0), makeTile('t6', 'D', 0, 1)];
    expect(isValidPlacement(board2, adjacent, false)).toBe(true);
    expect(isValidPlacement(board2, isolated, false)).toBe(false);
  });

  test('rejects placing on occupied cell', () => {
    const board = createEmptyBoard();
    const board2 = applyMoveToBoard(board, [makeTile('t1', 'A', 7, 7)]);
    const tiles = [makeTile('t2', 'T', 7, 7)]; // same cell
    expect(isValidPlacement(board2, tiles, false)).toBe(false);
  });
});
