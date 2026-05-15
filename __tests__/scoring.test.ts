import { scoreMove, getFormedWords } from '../src/engine/scoring';
import { createEmptyBoard, applyMoveToBoard } from '../src/engine/board';
import { PlacedTile } from '../src/types';

function makeTile(id: string, letter: string, value: number, row: number, col: number): PlacedTile {
  return { id, letter, value, row, col, isNew: true };
}

describe('scoreMove — basic scoring', () => {
  test('scores a simple word with no bonuses', () => {
    // Place CAT on row 7, cols 7-9 (center, but CAT doesn't hit any bonuses except START=DW)
    // C(4) + A(1) + T(1) = 6 * 2 (START double word) = 12
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'C', 4, 7, 7),
      makeTile('t2', 'A', 1, 7, 8),
      makeTile('t3', 'T', 1, 7, 9),
    ];
    const { total } = scoreMove(board, tiles);
    expect(total).toBe(12); // (4+1+1) * 2 for START square
  });

  test('single tile word scores just the word it forms', () => {
    // Place A at (7,7), then extend with B at (7,8)
    const board = createEmptyBoard();
    const board2 = applyMoveToBoard(board, [makeTile('t0', 'A', 1, 7, 7)]);
    // B at (7,8) — (7,8) has no bonus. Word = AB horizontal: A(1) + B(4) = 5
    const tiles = [makeTile('t1', 'B', 4, 7, 8)];
    const { total } = scoreMove(board2, tiles);
    expect(total).toBe(5);
  });

  test('bingo bonus adds 35 points for using all 7 tiles', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'P', 4, 7, 4),
      makeTile('t2', 'L', 2, 7, 5),
      makeTile('t3', 'A', 1, 7, 6),
      makeTile('t4', 'Y', 3, 7, 7),
      makeTile('t5', 'I', 1, 7, 8),
      makeTile('t6', 'N', 2, 7, 9),
      makeTile('t7', 'G', 3, 7, 10),
    ];
    const { total } = scoreMove(board, tiles);
    // Letter sum = 4+2+1+3+1+2+3 = 16, START DW on (7,7) = 32, + 35 bingo = 67
    expect(total).toBe(67);
  });
});

describe('scoreMove — bonus squares', () => {
  test('double letter bonus doubles that tile value', () => {
    const board = createEmptyBoard();
    // (0,3) is DL — place a Q(10) there
    // Q alone isn't a word but we test the math
    const tiles = [
      makeTile('t1', 'Q', 10, 0, 3),
      makeTile('t2', 'I', 1, 0, 4),
    ];
    const { total } = scoreMove(board, tiles);
    // Q(10)*2(DL) + I(1) = 21, no word multiplier
    expect(total).toBe(21);
  });

  test('triple word bonus triples the word score', () => {
    const board = createEmptyBoard();
    // (0,0) is TW
    const tiles = [
      makeTile('t1', 'A', 1, 0, 0),
      makeTile('t2', 'T', 1, 0, 1),
    ];
    const { total } = scoreMove(board, tiles);
    // A(1) + T(1) = 2 * 3(TW) = 6
    expect(total).toBe(6);
  });

  test('triple letter bonus triples that tile value', () => {
    const board = createEmptyBoard();
    // (1,5) is TL
    const tiles = [
      makeTile('t1', 'Z', 10, 1, 5),
      makeTile('t2', 'A', 1, 1, 6),
    ];
    const { total } = scoreMove(board, tiles);
    // Z(10)*3(TL) + A(1) = 31
    expect(total).toBe(31);
  });

  test('double word bonus doubles entire word', () => {
    const board = createEmptyBoard();
    // (1,1) is DW
    const tiles = [
      makeTile('t1', 'A', 1, 1, 1),
      makeTile('t2', 'T', 1, 1, 2),
    ];
    const { total } = scoreMove(board, tiles);
    // A(1) + T(1) = 2 * 2(DW) = 4
    expect(total).toBe(4);
  });

  test('bonus squares do not apply to already-placed tiles', () => {
    const board = createEmptyBoard();
    // Place A at (7,7) (START=DW). Then place T at (7,8) which has no bonus.
    // A was already placed so DW at (7,7) should NOT apply.
    // Word AT = A(1) + T(1) = 2
    const board2 = applyMoveToBoard(board, [makeTile('t0', 'A', 1, 7, 7)]);
    const tiles = [makeTile('t1', 'T', 1, 7, 8)];
    const { total } = scoreMove(board2, tiles);
    expect(total).toBe(2);
  });
});

describe('getFormedWords', () => {
  test('detects horizontal word', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'C', 4, 7, 7),
      makeTile('t2', 'A', 1, 7, 8),
      makeTile('t3', 'T', 1, 7, 9),
    ];
    const words = getFormedWords(board, tiles);
    expect(words).toContain('CAT');
  });

  test('detects vertical word', () => {
    const board = createEmptyBoard();
    const tiles = [
      makeTile('t1', 'C', 4, 7, 7),
      makeTile('t2', 'A', 1, 8, 7),
      makeTile('t3', 'T', 1, 9, 7),
    ];
    const words = getFormedWords(board, tiles);
    expect(words).toContain('CAT');
  });

  test('detects cross-words formed by new tiles', () => {
    const board = createEmptyBoard();
    // Place CAT horizontally
    const board2 = applyMoveToBoard(board, [
      makeTile('t1', 'C', 4, 7, 7),
      makeTile('t2', 'A', 1, 7, 8),
      makeTile('t3', 'T', 1, 7, 9),
    ]);
    // Now place AT vertically using existing A
    const newTiles = [
      makeTile('t4', 'B', 3, 8, 8), // B below the A in CAT
    ];
    const words = getFormedWords(board2, newTiles);
    // Should form AB vertically
    expect(words).toContain('AB');
  });

  test('does not return single-letter words', () => {
    const board = createEmptyBoard();
    const board2 = applyMoveToBoard(board, [makeTile('t1', 'A', 1, 7, 7)]);
    // Place a tile that only forms a 1-letter "word"
    const tiles = [makeTile('t2', 'B', 3, 5, 5)];
    const words = getFormedWords(board2, tiles);
    words.forEach((w) => expect(w.length).toBeGreaterThan(1));
  });

  test('includes word formed from existing + new tiles', () => {
    const board = createEmptyBoard();
    const board2 = applyMoveToBoard(board, [
      makeTile('t1', 'C', 4, 7, 7),
      makeTile('t2', 'A', 1, 7, 8),
    ]);
    // Extend with T to make CAT
    const tiles = [makeTile('t3', 'T', 1, 7, 9)];
    const words = getFormedWords(board2, tiles);
    expect(words).toContain('CAT');
  });
});
