/**
 * The premium-square layout lives in three places that must agree: the client
 * engine (`src/engine/board.ts`), the analysis export metadata, and the server
 * solver, which derives its bonus grid from the export. These tests pin that
 * they stay in sync and that the layout keeps the design properties it was
 * chosen for.
 */
import { createEmptyBoard, BOARD_SIZE } from '../src/engine/board';

const common = require('../netlify/functions/game-analysis-common');
const solver = require('../netlify/functions/lib/solver');

const { BOARD_METADATA, boardMetadataForGame } = common;
type Square = [number, number];
const NAMES = ['TW', 'DW', 'TL', 'DL', 'START'] as const;

function squaresOf(board: ReturnType<typeof createEmptyBoard>): Record<string, Square[]> {
  const out: Record<string, Square[]> = { TW: [], DW: [], TL: [], DL: [], START: [] };
  board.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (cell.bonus) out[cell.bonus].push([r, c]);
    })
  );
  return out;
}

const key = ([r, c]: Square) => `${r},${c}`;
const sorted = (list: Square[]) => list.map(key).sort();

describe('board layout stays in sync', () => {
  test('client board and export metadata describe the same squares', () => {
    const fromBoard = squaresOf(createEmptyBoard());
    for (const name of NAMES) {
      expect(sorted(fromBoard[name])).toEqual(sorted(BOARD_METADATA.bonusSquares[name]));
    }
    expect(BOARD_METADATA.version).toBe(2);
    expect(BOARD_METADATA.size).toBe(BOARD_SIZE);
  });

  test('the solver default grid matches the client board', () => {
    const board = createEmptyBoard();
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        const idx = r * BOARD_SIZE + c;
        const cell = solver.BONUS[idx];
        expect(cell ?? null).toEqual(board[r][c].bonus ?? null);
      }
    }
  });
});

describe('layout design rules', () => {
  const squares = squaresOf(createEmptyBoard());
  const all = [...squares.TW, ...squares.DW, ...squares.TL, ...squares.DL];

  test('square counts', () => {
    expect(squares.TW).toHaveLength(8);
    expect(squares.DW).toHaveLength(16);
    expect(squares.TL).toHaveLength(12);
    expect(squares.DL).toHaveLength(24);
    expect(squares.START).toEqual([[7, 7]]);
  });

  test('no two premium squares share a cell', () => {
    expect(new Set(all.map(key)).size).toBe(all.length);
    expect(all.map(key)).not.toContain('7,7');
  });

  test('the layout has full eight-way symmetry', () => {
    const last = BOARD_SIZE - 1;
    for (const name of ['TW', 'DW', 'TL', 'DL'] as const) {
      const set = new Set(squares[name].map(key));
      for (const [r, c] of squares[name]) {
        for (const [a, b] of [
          [c, r],
          [r, last - c],
          [last - r, c],
          [last - r, last - c],
        ]) {
          expect(set.has(`${a},${b}`)).toBe(true);
        }
      }
    }
  });

  test('no word premium sits on the middle row or column', () => {
    for (const [r, c] of [...squares.TW, ...squares.DW]) {
      expect(r).not.toBe(7);
      expect(c).not.toBe(7);
    }
  });

  test('triple-word squares in one lane are far apart', () => {
    for (const axis of [0, 1]) {
      const lanes = new Map<number, number[]>();
      for (const sq of squares.TW) {
        const lane = sq[axis];
        lanes.set(lane, [...(lanes.get(lane) ?? []), sq[1 - axis]]);
      }
      for (const positions of lanes.values()) {
        positions.sort((a, b) => a - b);
        for (let i = 1; i < positions.length; i++) {
          expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(8);
        }
      }
    }
  });

  test('a lane never holds both a triple-word and a double-word square', () => {
    for (const axis of [0, 1]) {
      const tw = new Set(squares.TW.map((sq) => sq[axis]));
      for (const sq of squares.DW) expect(tw.has(sq[axis])).toBe(false);
    }
  });
});

describe('boardMetadataForGame', () => {
  const boardFrom = (squaresByName: Record<string, Square[]>) => {
    const board: any[][] = Array.from({ length: BOARD_SIZE }, (_, r) =>
      Array.from({ length: BOARD_SIZE }, (_, c) => ({ row: r, col: c, bonus: null, tile: null }))
    );
    for (const [name, list] of Object.entries(squaresByName)) {
      for (const [r, c] of list) board[r][c].bonus = name;
    }
    return board;
  };

  test('a game on the current layout reports the current metadata', () => {
    expect(boardMetadataForGame({ board: createEmptyBoard() })).toBe(BOARD_METADATA);
  });

  test('a game with no or a malformed board falls back to the current metadata', () => {
    expect(boardMetadataForGame({})).toBe(BOARD_METADATA);
    expect(boardMetadataForGame(null)).toBe(BOARD_METADATA);
    expect(boardMetadataForGame({ board: [[]] })).toBe(BOARD_METADATA);
    const weird = boardFrom({ TW: [[1, 1]] });
    weird[0][0].bonus = 'NOPE';
    expect(boardMetadataForGame({ board: weird })).toBe(BOARD_METADATA);
  });

  test('a game stored on an older layout keeps its own squares as version 1', () => {
    const legacy = boardFrom({ TW: [[0, 0]], START: [[7, 7]] });
    const meta = boardMetadataForGame({ board: legacy });
    expect(meta.version).toBe(1);
    expect(meta.bonusSquares.TW).toEqual([[0, 0]]);
    expect(meta.size).toBe(BOARD_SIZE);
  });

  test('stored tiles never leak into the metadata', () => {
    const legacy = boardFrom({ TW: [[0, 0]], START: [[7, 7]] });
    legacy[3][3].tile = { id: 'secret-tile', letter: 'Q', value: 10 };
    expect(JSON.stringify(boardMetadataForGame({ board: legacy }))).not.toContain('secret-tile');
  });
});

describe('solver uses the layout from the export', () => {
  const HI = [
    { letter: 'H', value: 3 },
    { letter: 'I', value: 1 },
  ];
  const exportWith = (boardMetadata: unknown) => ({
    recordingQuality: 'full',
    players: [{ alias: 'player-1', displayName: 'Ada', finalScore: 0 }],
    ...(boardMetadata === undefined ? {} : { boardMetadata }),
    moves: [
      {
        turn: 1,
        version: 2,
        action: 'play',
        player: 'player-1',
        score: 8,
        placements: [
          { row: 7, col: 7, letter: 'H', value: 3 },
          { row: 7, col: 8, letter: 'I', value: 1 },
        ],
        rackBefore: HI,
      },
    ],
  });
  const custom = {
    ...BOARD_METADATA,
    bonusSquares: { TW: [[7, 8]], DW: [], TL: [], DL: [], START: [[7, 7]] },
  };

  test('a custom triple-word square changes the best score', () => {
    const withCustom = solver.solveGame(exportWith(custom), { askingAlias: 'player-1' });
    // HI: (3+1) x2 for START x3 for the TW at (7,8).
    expect(withCustom.turns[0].best[0].score).toBe(24);
  });

  test('without metadata the current default layout applies', () => {
    const plain = solver.solveGame(exportWith(undefined), { askingAlias: 'player-1' });
    // (7,8) is a plain square on the default layout: 4 x2 for START.
    expect(plain.turns[0].best[0].score).toBe(8);
  });

  test('malformed metadata falls back to the default layout', () => {
    for (const bad of [
      { ...custom, size: 9 },
      { ...custom, bonusSquares: { TW: [[99, 99]] } },
      { ...custom, bonusSquares: { ZZ: [[7, 8]] } },
      'nope',
    ]) {
      const result = solver.solveGame(exportWith(bad), { askingAlias: 'player-1' });
      expect(result.turns[0].best[0].score).toBe(8);
    }
  });

  test('a custom layout does not leak into the next solve', () => {
    solver.solveGame(exportWith(custom), { askingAlias: 'player-1' });
    const after = solver.solveGame(exportWith(undefined), { askingAlias: 'player-1' });
    expect(after.turns[0].best[0].score).toBe(8);
  });
});
