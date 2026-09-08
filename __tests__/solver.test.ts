/**
 * The server-side solver duplicates `src/engine/scoring.ts` because the Netlify
 * functions bundle is CommonJS and cannot consume TypeScript. These tests are
 * what stop the two from drifting.
 */
import {
  createEmptyBoard,
  applyMoveToBoard,
  isValidPlacement,
} from '../src/engine/board';
import { scoreMove, getFormedWords } from '../src/engine/scoring';
import { Board, PlacedTile } from '../src/types';

const solver = require('../netlify/functions/lib/solver');

type Placement = {
  row: number;
  col: number;
  letter: string;
  value: number;
  isBlank?: boolean;
};

// WWF tile values.
const VALUES: Record<string, number> = {
  A: 1, B: 4, C: 4, D: 2, E: 1, F: 4, G: 3, H: 3, I: 1, J: 10, K: 5, L: 2, M: 4,
  N: 2, O: 1, P: 4, Q: 10, R: 1, S: 1, T: 1, U: 2, V: 5, W: 4, X: 8, Y: 3, Z: 10,
};

/** "CAT" at (7,7) across -> three placements with real tile values. */
function spell(
  word: string,
  row: number,
  col: number,
  direction: 'across' | 'down'
): Placement[] {
  return word.split('').map((letter, i) => ({
    row: direction === 'down' ? row + i : row,
    col: direction === 'across' ? col + i : col,
    letter,
    value: VALUES[letter],
  }));
}

function rack(letters: string): { letter: string; value: number; isBlank?: boolean }[] {
  return letters.split('').map((letter) =>
    letter === '?'
      ? { letter: '', value: 0, isBlank: true }
      : { letter, value: VALUES[letter] }
  );
}

function toPlacedTiles(placements: Placement[]): PlacedTile[] {
  return placements.map((p, i) => ({
    id: `t-${i}`,
    letter: p.letter,
    value: p.value,
    isBlank: p.isBlank === true,
    row: p.row,
    col: p.col,
  }));
}

/** Build the same position as a TS Board and as a solver grid. */
function position(history: Placement[][]): { board: Board; grid: any[] } {
  let board = createEmptyBoard();
  const grid = solver.emptyGrid();
  for (const placements of history) {
    board = applyMoveToBoard(board, toPlacedTiles(placements));
    solver.applyPlacements(grid, placements);
  }
  return { board, grid };
}

describe('solver scoring parity with src/engine/scoring.ts', () => {
  // A corpus of positions x candidate plays covering the cases where the two
  // implementations could plausibly disagree.
  const cases: { name: string; history: Placement[][]; play: Placement[] }[] = [
    {
      name: 'first move over the centre star',
      history: [],
      play: spell('CAT', 7, 7, 'across'),
    },
    {
      name: 'first move straddling the star and a double letter',
      history: [],
      play: spell('QUARTZ', 7, 3, 'across'),
    },
    {
      name: 'first move played down through the star',
      history: [],
      play: spell('LOVE', 5, 7, 'down'),
    },
    {
      name: 'cross-word hooked off an existing word',
      history: [spell('CAT', 7, 7, 'across')],
      // OTHER down through the existing T at (7,9) — only O/H/E/R are laid.
      play: [
        { row: 6, col: 9, letter: 'O', value: VALUES.O },
        { row: 8, col: 9, letter: 'H', value: VALUES.H },
        { row: 9, col: 9, letter: 'E', value: VALUES.E },
        { row: 10, col: 9, letter: 'R', value: VALUES.R },
      ],
    },
    {
      name: 'single tile forming two words at once',
      history: [
        spell('CAT', 7, 7, 'across'),
        [
          { row: 8, col: 8, letter: 'R', value: VALUES.R },
          { row: 9, col: 8, letter: 'E', value: VALUES.E },
        ],
      ],
      play: [{ row: 8, col: 7, letter: 'T', value: VALUES.T }],
    },
    {
      name: 'extends an existing word — old tiles keep their bare value',
      history: [spell('CAT', 7, 7, 'across')],
      play: [{ row: 7, col: 10, letter: 'S', value: VALUES.S }],
    },
    {
      name: 'new tile lands on a triple letter square',
      history: [spell('CAT', 7, 7, 'across')],
      play: spell('AXE', 9, 9, 'across'),
    },
    {
      name: 'word reaching a double word square',
      history: [spell('CAT', 7, 7, 'across')],
      play: spell('ROAM', 7, 10, 'down'),
    },
    {
      name: 'blank tile scores zero on a premium square',
      history: [spell('CAT', 7, 7, 'across')],
      play: [
        { row: 9, col: 9, letter: 'Z', value: 0, isBlank: true },
        { row: 9, col: 10, letter: 'A', value: VALUES.A },
      ],
    },
    {
      name: 'seven-tile bingo',
      history: [spell('CAT', 7, 7, 'across')],
      play: spell('RETINAS', 8, 5, 'across'),
    },
    {
      name: 'new tiles on a triple letter, finishing on an old tile',
      history: [
        spell('QUARTZ', 7, 3, 'across'),
        // ZED down off the existing Z at (7,8).
        [
          { row: 8, col: 8, letter: 'E', value: VALUES.E },
          { row: 9, col: 8, letter: 'D', value: VALUES.D },
        ],
      ],
      // AXE at (9,5)-(9,7) runs into the existing D at (9,8): AXED.
      play: spell('AXE', 9, 5, 'across'),
    },
    {
      name: 'an old tile on the START square does not double the word again',
      history: [spell('CAT', 7, 7, 'across')],
      play: [{ row: 7, col: 6, letter: 'S', value: VALUES.S }],
    },
    {
      name: 'vertical play generating several cross-words',
      history: [
        spell('CAT', 7, 7, 'across'),
        [
          { row: 6, col: 9, letter: 'O', value: VALUES.O },
          { row: 8, col: 9, letter: 'H', value: VALUES.H },
          { row: 9, col: 9, letter: 'E', value: VALUES.E },
          { row: 10, col: 9, letter: 'R', value: VALUES.R },
        ],
      ],
      play: [
        { row: 8, col: 8, letter: 'R', value: VALUES.R },
        { row: 9, col: 8, letter: 'T', value: VALUES.T },
        { row: 10, col: 8, letter: 'S', value: VALUES.S },
      ],
    },
  ];

  for (const testCase of cases) {
    test(testCase.name, () => {
      const { board, grid } = position(testCase.history);
      const before = JSON.stringify(grid);
      const expected = scoreMove(board, toPlacedTiles(testCase.play));
      const actual = solver.scorePlay(grid, testCase.play);

      expect(actual.words).toEqual(expected.words);
      expect(actual.total).toBe(expected.total);
      expect(actual.words.length).toBeGreaterThan(0);
      // The scratch grid must come back exactly as it went in.
      expect(JSON.stringify(grid)).toBe(before);
    });
  }

  test('the bingo bonus lives outside the word scores', () => {
    const { board, grid } = position([spell('CAT', 7, 7, 'across')]);
    const play = spell('RETINAS', 8, 5, 'across');

    const expected = scoreMove(board, toPlacedTiles(play));
    const actual = solver.scorePlay(grid, play);

    const wordSum = actual.words.reduce((sum: number, w: any) => sum + w.score, 0);
    expect(play).toHaveLength(7);
    expect(actual.total - wordSum).toBe(35);
    expect(expected.total - expected.words.reduce((s, w) => s + w.score, 0)).toBe(35);
  });

  test('a six-tile play gets no bonus', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const play = spell('RETINA', 8, 5, 'across');
    const actual = solver.scorePlay(grid, play);
    const wordSum = actual.words.reduce((sum: number, w: any) => sum + w.score, 0);
    expect(actual.total).toBe(wordSum);
  });
});

describe('move generation', () => {
  test('the first move covers the centre star and uses the whole rack', () => {
    const { grid } = position([]);
    const { moves } = solver.findBestMoves(grid, rack('CATERSL'));

    expect(moves.length).toBeGreaterThan(0);
    const best = moves[0];
    // CARTELS across from (7,3): C on the (7,3) DL is 8, then A/R/T/E/L/S are
    // 1+1+1+1+2+1 -> 15; the E on the START square doubles the word to 30; the
    // seven-tile bingo adds 35. 65.
    expect(best.score).toBe(65);
    expect(best.placements).toHaveLength(7);
    expect(best.word).toBe('CARTELS');
    expect(best.col).toBe(3);
    expect(
      best.placements.some((p: Placement) => p.row === 7 && p.col === 7)
    ).toBe(true);
    for (const move of moves) {
      expect(
        move.placements.some((p: Placement) => p.row === 7 && p.col === 7)
      ).toBe(true);
    }
  });

  // None of the real game fixtures contains a seven-tile play, so the bingo path
  // gets this hand-computed synthetic position instead.
  test('finds a seven-tile bingo and adds the 35 on top of the word scores', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const { moves } = solver.findBestMoves(grid, rack('RETINAS'));
    const best = moves[0];

    // ANESTRI down column 10, rows 4-10. Letters A/N/E/S/T/R/I are
    // 1+2+1+1+1+1+1 = 8; (4,10) and (10,10) are both DW, so 8 x 4 = 32.
    // The S at (7,10) also extends CAT into CATS: 4+1+1 (old tiles, bare) + 1 = 7.
    // 32 + 7 = 39 for the words, + 35 for the bingo = 74.
    expect(best.word).toBe('ANESTRI');
    expect(best.placements).toHaveLength(7);
    expect(best.words).toEqual([
      { word: 'ANESTRI', score: 32 },
      { word: 'CATS', score: 7 },
    ]);
    expect(best.score).toBe(74);

    const wordSum = best.words.reduce((sum: number, w: any) => sum + w.score, 0);
    expect(wordSum).toBe(39);
    expect(best.score - wordSum).toBe(35);
    // And the TypeScript engine agrees.
    const { board } = position([spell('CAT', 7, 7, 'across')]);
    expect(scoreMove(board, toPlacedTiles(best.placements)).total).toBe(74);
  });

  test('a blank is played as whatever letter scores best, always for zero', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    // Only the blank can supply the second letter of a two-letter word here.
    const { moves } = solver.findBestMoves(grid, rack('Q?'));
    expect(moves.length).toBeGreaterThan(0);
    const withBlank = moves.filter((m: any) =>
      m.placements.some((p: Placement) => p.isBlank)
    );
    for (const move of withBlank) {
      for (const p of move.placements) {
        if (p.isBlank) expect(p.value).toBe(0);
      }
    }
  });

  test('cross-words are found and every formed word is a real word', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const { moves } = solver.findBestMoves(grid, rack('SHOEIN'), { limit: 40 });
    expect(moves.length).toBeGreaterThan(0);
    const dictionary = require('../netlify/functions/lib/dictionary');
    for (const move of moves) {
      for (const word of move.words) {
        expect(dictionary.isValidWord(word.word)).toBe(true);
      }
    }
  });

  test('every generated play is legal and scores what the engine says', () => {
    const { board, grid } = position([
      spell('CAT', 7, 7, 'across'),
      [
        { row: 6, col: 9, letter: 'O', value: VALUES.O },
        { row: 8, col: 9, letter: 'H', value: VALUES.H },
        { row: 9, col: 9, letter: 'E', value: VALUES.E },
        { row: 10, col: 9, letter: 'R', value: VALUES.R },
      ],
    ]);
    const { moves } = solver.findBestMoves(grid, rack('SLATEN'), { limit: 60 });
    expect(moves.length).toBeGreaterThan(10);

    for (const move of moves) {
      // One line, no gaps, empty cells, connected, all words in the dictionary.
      expect(solver.isLegalPlay(grid, move.placements, false)).toBe(true);
      // And the score agrees with the TypeScript engine.
      expect(scoreMove(board, toPlacedTiles(move.placements)).total).toBe(move.score);
    }
  });

  test('plays only use tiles that were actually on the rack', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const letters = 'SLATEN';
    const { moves } = solver.findBestMoves(grid, rack(letters), { limit: 60 });

    for (const move of moves) {
      const available = letters.split('');
      for (const p of move.placements) {
        const i = available.indexOf(p.letter);
        expect(p.isBlank === true || i).not.toBe(-1);
        if (i >= 0) available.splice(i, 1);
      }
      expect(move.placements.length).toBeLessThanOrEqual(letters.length);
    }
  });

  test('results are ranked by score, high to low', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const { moves } = solver.findBestMoves(grid, rack('SLATEN'), { limit: 20 });
    for (let i = 1; i < moves.length; i++) {
      expect(moves[i - 1].score).toBeGreaterThanOrEqual(moves[i].score);
    }
  });

  test('the top plays are de-duplicated by word, position and direction', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    const { moves } = solver.findBestMoves(grid, rack('SLATEN?'), { limit: 25 });
    const keys = moves.map(
      (m: any) => `${m.word}|${m.row}|${m.col}|${m.direction}`
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('an empty rack yields no plays', () => {
    const { grid } = position([spell('CAT', 7, 7, 'across')]);
    expect(solver.findBestMoves(grid, []).moves).toEqual([]);
  });
});

describe('legality checks', () => {
  const { grid } = position([spell('CAT', 7, 7, 'across')]);

  test('rejects a play that occupies a filled cell', () => {
    expect(
      solver.isLegalPlay(grid, [{ row: 7, col: 7, letter: 'S', value: 1 }], false)
    ).toBe(false);
  });

  test('rejects a play with a gap in it', () => {
    expect(
      solver.isLegalPlay(
        grid,
        [
          { row: 9, col: 7, letter: 'A', value: 1 },
          { row: 9, col: 9, letter: 'T', value: 1 },
        ],
        false
      )
    ).toBe(false);
  });

  test('rejects a disconnected play', () => {
    expect(solver.isLegalPlay(grid, spell('DOG', 0, 0, 'across'), false)).toBe(false);
  });

  test('rejects a play spanning two rows and two columns', () => {
    expect(
      solver.isLegalPlay(
        grid,
        [
          { row: 8, col: 7, letter: 'A', value: 1 },
          { row: 9, col: 8, letter: 'T', value: 1 },
        ],
        false
      )
    ).toBe(false);
  });

  test('rejects a play forming a word outside the dictionary', () => {
    expect(solver.isLegalPlay(grid, spell('ZZZQ', 8, 7, 'across'), false)).toBe(false);
  });

  test('rejects a first move that misses the centre star', () => {
    const empty = solver.emptyGrid();
    expect(solver.isLegalPlay(empty, spell('CAT', 0, 0, 'across'), true)).toBe(false);
    expect(solver.isLegalPlay(empty, spell('CAT', 7, 7, 'across'), true)).toBe(true);
  });

  test('accepts a legal hook onto an existing word', () => {
    expect(
      solver.isLegalPlay(grid, [{ row: 7, col: 10, letter: 'S', value: 1 }], false)
    ).toBe(true);
  });
});

describe('solveGame', () => {
  function playMove(turn: number, player: string, placements: Placement[], score: number) {
    return {
      turn,
      version: 2,
      action: 'play',
      player,
      score,
      placements,
      words: [{ word: placements.map((p) => p.letter).join(''), score }],
      rackBefore: undefined as any,
    };
  }

  const exportData = {
    recordingQuality: 'full',
    players: [
      { alias: 'player-1', displayName: 'Ada', finalScore: 40 },
      { alias: 'player-2', displayName: 'Bo', finalScore: 20 },
    ],
    moves: [
      {
        ...playMove(1, 'player-1', spell('CAT', 7, 7, 'across'), 18),
        rackBefore: rack('CATERSL'),
      },
      {
        ...playMove(
          2,
          'player-2',
          [
            { row: 6, col: 9, letter: 'O', value: VALUES.O },
            { row: 8, col: 9, letter: 'H', value: VALUES.H },
            { row: 9, col: 9, letter: 'E', value: VALUES.E },
            { row: 10, col: 9, letter: 'R', value: VALUES.R },
          ],
          12
        ),
        rackBefore: rack('OHERXYI'),
      },
      // No rackBefore: a turn recorded before full move tracking existed.
      playMove(3, 'player-1', [{ row: 7, col: 10, letter: 'S', value: 1 }], 4),
      { turn: 4, version: 2, action: 'pass', player: 'player-2', score: 0, placements: [] },
    ],
  };

  test('solves every turn against the board as it stood before it', () => {
    const result = solver.solveGame(exportData, { askingAlias: 'player-1' });
    expect(result.turns).toHaveLength(4);
    expect(result.turns.map((t: any) => t.turn)).toEqual([1, 2, 3, 4]);
    expect(result.turns.map((t: any) => t.isAsking)).toEqual([true, false, true, false]);
    expect(result.recordingQuality).toBe('full');
    expect(result.askingAlias).toBe('player-1');
    expect(result.truncated).toBe(false);
    // No emails or UIDs, only the aliased player summary.
    expect(result.players).toEqual([
      { alias: 'player-1', displayName: 'Ada', finalScore: 40 },
      { alias: 'player-2', displayName: 'Bo', finalScore: 20 },
    ]);
  });

  test('turn 1 was played on an empty board, so its best play covers the star', () => {
    const result = solver.solveGame(exportData, { askingAlias: 'player-1' });
    const turn1 = result.turns[0];
    expect(turn1.solved).toBe(true);
    expect(turn1.best.length).toBeGreaterThan(0);
    expect(turn1.best[0].score).toBe(65);
    expect(turn1.pointsLeft).toBe(65 - 18);
    expect(turn1.wasBest).toBe(false);
  });

  test('best[0].score is never below the score actually played', () => {
    const result = solver.solveGame(exportData, { askingAlias: 'player-1' });
    for (const turn of result.turns) {
      if (!turn.solved || turn.best.length === 0 || !turn.played) continue;
      expect(turn.best[0].score).toBeGreaterThanOrEqual(turn.played.score);
      expect(turn.pointsLeft).toBe(turn.best[0].score - turn.played.score);
    }
  });

  test('finding the top play reports wasBest and zero points left', () => {
    const best = { ...exportData.moves[0], score: 65, words: [{ word: 'CARTELS', score: 30 }] };
    const result = solver.solveGame(
      { ...exportData, moves: [best] },
      { askingAlias: 'player-1' }
    );
    expect(result.turns[0].pointsLeft).toBe(0);
    expect(result.turns[0].wasBest).toBe(true);
  });

  test('turns without a recorded rack come back unsolved, never guessed', () => {
    const result = solver.solveGame(exportData, { askingAlias: 'player-1' });
    const turn3 = result.turns[2];
    expect(turn3.solved).toBe(false);
    expect(turn3.best).toEqual([]);
    expect(turn3.pointsLeft).toBeNull();
    expect(turn3.wasBest).toBeNull();
    // The played move is still reported so the table has a row for it.
    expect(turn3.played).toEqual({ word: 'S', score: 4 });
  });

  test('a basic-quality game returns every turn unsolved but still listed', () => {
    const basic = {
      recordingQuality: 'basic',
      players: exportData.players,
      moves: exportData.moves.map(({ rackBefore, ...rest }: any) => rest),
    };
    const result = solver.solveGame(basic, { askingAlias: 'player-1' });
    expect(result.recordingQuality).toBe('basic');
    expect(result.turns).toHaveLength(4);
    expect(result.turns.every((t: any) => t.solved === false)).toBe(true);
    expect(result.turns.every((t: any) => t.best.length === 0)).toBe(true);
  });

  test('passes and swaps are listed with no played word', () => {
    const result = solver.solveGame(exportData, { askingAlias: 'player-1' });
    expect(result.turns[3].action).toBe('pass');
    expect(result.turns[3].played).toBeNull();
  });

  test('an exhausted time budget flags the result truncated instead of running on', () => {
    const result = solver.solveGame(exportData, {
      askingAlias: 'player-1',
      budgetMs: -1,
    });
    expect(result.truncated).toBe(true);
    expect(result.turns.every((t: any) => t.solved === false)).toBe(true);
  });
});

// Real finished games pulled from production (display names scrubbed). These
// are the only fixtures that exercise the generator against genuine mid-game
// board density — a synthetic position is far too open to be representative.
describe('real game fixtures', () => {
  const full = require('./fixtures/real-game-full.json');
  const mixed = require('./fixtures/real-game-mixed.json');
  const legacy = require('./fixtures/real-game-legacy.json');

  // recordingQuality is a whole-game verdict: sanitizeGameExport downgrades the
  // entire export to 'basic' if any single event fails provenance. Solving is
  // therefore gated per turn on rackBefore, never on the quality flag.
  test('a basic-quality game still solves every turn that recorded a rack', () => {
    const withRack = mixed.moves.filter(
      (m: any) => Array.isArray(m.rackBefore) && m.rackBefore.length > 0
    ).length;
    expect(mixed.recordingQuality).toBe('basic');
    expect(mixed.moves).toHaveLength(41);
    expect(withRack).toBe(36);

    const result = solver.solveGame(mixed, { askingAlias: 'player-1', budgetMs: 60000 });
    expect(result.turns.filter((t: any) => t.solved)).toHaveLength(36);
    expect(result.turns.filter((t: any) => !t.solved)).toHaveLength(5);
    expect(result.truncated).toBe(false);
    // The unsolved ones are exactly the turns with no rack, and they invent nothing.
    for (const turn of result.turns.filter((t: any) => !t.solved)) {
      expect(turn.best).toEqual([]);
      expect(turn.pointsLeft).toBeNull();
      expect(turn.wasBest).toBeNull();
    }
  });

  test('a legacy game returns every turn unsolved and never guesses a play', () => {
    expect(legacy.moves).toHaveLength(43);
    const result = solver.solveGame(legacy, { askingAlias: 'player-1', budgetMs: 60000 });
    expect(result.turns).toHaveLength(43);
    expect(result.turns.every((t: any) => t.solved === false)).toBe(true);
    expect(result.turns.every((t: any) => t.best.length === 0)).toBe(true);
    expect(result.turns.every((t: any) => t.pointsLeft === null)).toBe(true);
    // Every played move is still listed so the table has a row for each turn.
    expect(result.turns.every((t: any) => t.played !== null)).toBe(true);
  });

  for (const [name, fixture, solvedCount] of [
    ['real-game-full', full, 39],
    ['real-game-mixed', mixed, 36],
  ] as const) {
    test(`${name}: the solver never misses a play the player actually made`, () => {
      const result = solver.solveGame(fixture, {
        askingAlias: 'player-1',
        budgetMs: 60000,
      });
      expect(result.turns.filter((t: any) => t.solved)).toHaveLength(solvedCount);

      for (const turn of result.turns) {
        if (!turn.solved || !turn.played || turn.best.length === 0) continue;
        // The played move was legal from the recorded rack, so the enumeration
        // must have found it — or something better.
        expect(turn.best[0].score).toBeGreaterThanOrEqual(turn.played.score);
        expect(turn.pointsLeft).toBe(turn.best[0].score - turn.played.score);
        expect(turn.wasBest).toBe(turn.pointsLeft === 0);
      }
    });
  }

  test('every play the solver proposes on a real board is legal and scores correctly', () => {
    let board = createEmptyBoard();
    const grid = solver.emptyGrid();
    let checked = 0;

    for (const move of full.moves) {
      if (Array.isArray(move.rackBefore) && move.rackBefore.length > 0) {
        const isFirstMove = grid.every((cell: any) => !cell);
        const { moves } = solver.findBestMoves(grid, move.rackBefore, { limit: 5 });
        for (const candidate of moves) {
          expect(solver.isLegalPlay(grid, candidate.placements, isFirstMove)).toBe(true);
          // The TypeScript engine is the arbiter of the score.
          expect(scoreMove(board, toPlacedTiles(candidate.placements)).total).toBe(
            candidate.score
          );
          checked++;
        }
      }
      board = applyMoveToBoard(board, toPlacedTiles(move.placements));
      solver.applyPlacements(grid, move.placements);
    }
    expect(checked).toBeGreaterThan(150);
  });

  test('a full 39-turn game solves well inside the Netlify budget', () => {
    const started = Date.now();
    const result = solver.solveGame(full, { askingAlias: 'player-1', budgetMs: 4000 });
    const elapsed = Date.now() - started;

    expect(result.truncated).toBe(false);
    expect(result.turns).toHaveLength(39);
    // The coach endpoint allows the solver 4s of a 10s function timeout.
    expect(elapsed).toBeLessThan(4000);
  });
});

/**
 * Completeness, the property nothing else pins.
 *
 * Every other generation test asserts that what the solver returns is legal and
 * correctly scored — none of them can catch the solver failing to return a play
 * at all. That is exactly the shape of the left-part bug that shipped in
 * iteration 1: it silently dropped plays and all 316 tests still passed.
 *
 * The oracle here shares no code with the generator. It enumerates candidate
 * placements by construction and judges them entirely with the TypeScript
 * engine — `isValidPlacement` for geometry, `getFormedWords` for the words,
 * `scoreMove` for the score — so a future prune that drops a play has nothing
 * to hide behind.
 *
 * It asserts the WHOLE `limit: 5` list, not just `moves[0]`. Asserting only the
 * top play left the exact regression the de-dup-by-word change can cause —
 * dropping non-top plays out of the five slots — unable to fail this suite.
 */
describe('generator completeness (brute-force cross-check)', () => {
  const full = require('./fixtures/real-game-full.json');
  const dictionary = require('../netlify/functions/lib/dictionary');

  type Spec = { letter: string; value: number; isBlank?: boolean };

  /** Every ordered arrangement of every non-empty subset of `items`. */
  function arrangements<T>(letters: T[]): T[][] {
    const out: T[][] = [];
    const walk = (chosen: T[], rest: T[]) => {
      if (chosen.length > 0) out.push(chosen.slice());
      for (let i = 0; i < rest.length; i++) {
        chosen.push(rest[i]);
        walk(chosen, rest.slice(0, i).concat(rest.slice(i + 1)));
        chosen.pop();
      }
    };
    walk([], letters);
    return out;
  }

  /** Every concrete letter assignment of the blanks in `specs`. */
  function expandBlanks(specs: Spec[]): Spec[][] {
    const idx = specs.findIndex((s) => s.isBlank && !s.letter);
    if (idx < 0) return [specs];
    const out: Spec[][] = [];
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const next = specs.slice();
      // A designated blank still scores 0 — that is the whole point of it.
      next[idx] = { letter, value: 0, isBlank: true };
      out.push(...expandBlanks(next));
    }
    return out;
  }

  /**
   * Name a play the way the generator does, independently of it: the contiguous
   * run through the placed tiles along the play's own direction. A single-tile
   * play takes its across word when that is longer than one letter (the
   * generator runs across first and de-dups by the physical play), otherwise
   * its down word.
   */
  function playWord(board: Board, placements: Placement[]): string {
    const placedAt = (r: number, c: number) =>
      placements.find((p) => p.row === r && p.col === c);
    const filled = (r: number, c: number) =>
      r >= 0 && r < 15 && c >= 0 && c < 15 && (board[r][c].tile !== null || !!placedAt(r, c));
    const run = (dRow: number, dCol: number) => {
      let r = placements[0].row;
      let c = placements[0].col;
      while (filled(r - dRow, c - dCol)) {
        r -= dRow;
        c -= dCol;
      }
      let word = '';
      while (filled(r, c)) {
        const p = placedAt(r, c);
        word += p ? p.letter : (board[r][c].tile as any).letter.toUpperCase();
        r += dRow;
        c += dCol;
      }
      return word;
    };

    if (placements.length > 1) {
      const across = placements.every((p) => p.row === placements[0].row);
      return across ? run(0, 1) : run(1, 0);
    }
    const across = run(0, 1);
    return across.length > 1 ? across : run(1, 0);
  }

  /**
   * The independent enumerator: for every start square, direction and ordered
   * rack subset, lay the tiles into the empty squares running that way,
   * stepping over tiles already on the board. Returns the top `limit` legal
   * plays, one entry per distinct word with that word's best score — the same
   * shape `findBestMoves` returns, so the whole list can be compared.
   */
  function bruteForceTop(
    board: Board,
    specs: Spec[],
    isFirstMove: boolean,
    limit = 5
  ): { word: string; score: number }[] {
    const bestByWord = new Map<string, number>();

    for (const concrete of expandBlanks(specs)) {
      for (const [dRow, dCol] of [[0, 1], [1, 0]]) {
        for (let row = 0; row < 15; row++) {
          for (let col = 0; col < 15; col++) {
            // A play cannot start on an occupied square: the word would really
            // start further back, and that start square is enumerated too.
            if (board[row][col].tile !== null) continue;

            for (const arrangement of arrangements(concrete)) {
              const placements: Placement[] = [];
              let r = row;
              let c = col;
              let ok = true;

              for (const spec of arrangement) {
                // Step over tiles already on the board — that is what makes a
                // play "contiguous" across an existing word rather than gapped.
                while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c].tile !== null) {
                  r += dRow;
                  c += dCol;
                }
                if (r < 0 || r >= 15 || c < 0 || c >= 15) { ok = false; break; }
                placements.push({
                  row: r,
                  col: c,
                  letter: spec.letter,
                  value: spec.value,
                  isBlank: spec.isBlank,
                });
                r += dRow;
                c += dCol;
              }
              if (!ok) continue;

              const tiles = toPlacedTiles(placements);
              if (!isValidPlacement(board, tiles, isFirstMove)) continue;

              const words = getFormedWords(board, tiles);
              if (words.length === 0) continue;
              if (!words.every((w) => w.length > 1 && dictionary.isValidWord(w))) continue;

              const { total } = scoreMove(board, tiles);
              const word = playWord(board, placements);
              const seen = bestByWord.get(word);
              if (seen === undefined || total > seen) bestByWord.set(word, total);
            }
          }
        }
      }
    }

    return [...bestByWord.entries()]
      .map(([word, score]) => ({ word, score }))
      .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
      .slice(0, limit);
  }

  /** The generator's own list, reduced to what the oracle can speak about. */
  function solverTop(grid: any[], tiles: any[], limit = 5) {
    const { moves } = solver.findBestMoves(grid, tiles, { limit });
    return moves.map((m: any) => ({ word: m.word, score: m.score }));
  }

  /** Replay `real-game-full` up to (not including) move index `upTo`. */
  function positionAfter(upTo: number): { board: Board; grid: any[] } {
    let board = createEmptyBoard();
    const grid = solver.emptyGrid();
    for (let i = 0; i < upTo; i++) {
      const move = full.moves[i];
      board = applyMoveToBoard(board, toPlacedTiles(move.placements));
      solver.applyPlacements(grid, move.placements);
    }
    return { board, grid };
  }

  // Three genuine mid-game positions from a real production game, each with a
  // dense board. Racks are the first four tiles the player actually held, which
  // keeps the brute force to ~29k candidates per position.
  for (const upTo of [8, 16, 24]) {
    test(`the solver's top 5 equals a brute-force top 5 after ${upTo} real moves`, () => {
      const { board, grid } = positionAfter(upTo);
      const letters = full.moves[upTo].rackBefore
        .filter((t: any) => t.letter && !t.isBlank)
        .slice(0, 4)
        .map((t: any) => t.letter);
      expect(letters.length).toBe(4);

      const brute = bruteForceTop(board, rack(letters.join('')), false, 5);
      const mine = solverTop(grid, rack(letters.join('')), 5);

      expect(brute.length).toBe(5);
      // The whole point: not "the solver's play is legal", and not just "its
      // top play matches" — the entire five-slot list has to match, so a prune
      // that drops a non-top play has nowhere to hide.
      expect(mine).toEqual(brute);
    });
  }

  test('the solver finds the brute-force top 5 opener from a 5-tile rack', () => {
    const board = createEmptyBoard();
    const grid = solver.emptyGrid();
    const letters = ['C', 'A', 'T', 'E', 'R'];

    const brute = bruteForceTop(board, rack(letters.join('')), true, 5);
    const mine = solverTop(grid, rack(letters.join('')), 5);

    expect(brute.length).toBe(5);
    expect(mine).toEqual(brute);
  });

  test("the solver's top 5 equals a brute-force top 5 from a blank-bearing rack", () => {
    // A blank multiplies the search by 26, so the rack is small — but this is
    // the only completeness check that exercises blank assignment at all, and
    // blanks are where a de-dup-by-word change is most likely to collapse
    // distinct plays into one.
    const { board, grid } = positionAfter(16);
    const tiles = rack('DO?');

    const brute = bruteForceTop(board, tiles, false, 5);
    const mine = solverTop(grid, tiles, 5);

    expect(brute.length).toBe(5);
    expect(mine).toEqual(brute);
    // And the blank really is in play — otherwise this would just be a 2-tile
    // rack wearing a costume.
    const { moves } = solver.findBestMoves(grid, tiles, { limit: 5 });
    expect(
      moves.some((m: any) => m.placements.some((p: any) => p.isBlank === true))
    ).toBe(true);
  });
});

describe('budget enforcement across the whole solve', () => {
  /** `count` turns that each cost a real but small generation. */
  function cheapGame(count: number, letters: string) {
    const moves: any[] = [
      {
        turn: 1,
        action: 'play',
        player: 'player-1',
        placements: spell('CAT', 7, 7, 'across'),
        words: [{ word: 'CAT', score: 12 }],
        score: 12,
      },
    ];
    for (let i = 0; i < count; i++) {
      moves.push({
        turn: i + 2,
        action: 'pass',
        player: 'player-1',
        placements: [],
        rackBefore: rack(letters),
      });
    }
    return { moves, players: [], recordingQuality: 'full' };
  }

  test('a zero budget stops the solve immediately, however cheap the turns', () => {
    // The DFS samples the clock every 2048 nodes, so a game of cheap turns can
    // run to completion without one call ever reaching the sample. The budget
    // has to be tested at the turn boundary as well.
    const result = solver.solveGame(cheapGame(40, 'A'), { budgetMs: 0 });
    expect(result.truncated).toBe(true);
    expect(result.turns.filter((t: any) => t.solved)).toHaveLength(0);
    // Those 40 turns are LISTED but carry no verdict. Nothing was dropped from
    // the response, so the client must not say "turns are not shown".
    expect(result.turnsOmitted).toBe(0);
    expect(result.turnsUnanalyzed).toBe(40);
    expect(result.turns.filter((t: any) => t.unanalyzed === true)).toHaveLength(40);
  });

  test('the budget holds across thousands of cheap turns', () => {
    const started = Date.now();
    const result = solver.solveGame(cheapGame(20000, 'SERO'), {
      budgetMs: 500,
      maxTurns: 1e9,
    });
    const elapsed = Date.now() - started;

    expect(result.truncated).toBe(true);
    // Without a shared clock this ran for many multiples of the budget.
    expect(elapsed).toBeLessThan(3000);
    // And it stopped solving rather than running the whole game.
    expect(result.turns.filter((t: any) => t.solved).length).toBeLessThan(20000);
  });

  test('the turn count is capped independently of the clock', () => {
    const result = solver.solveGame(cheapGame(5000, 'A'), {
      budgetMs: 60000,
      maxTurns: 50,
    });
    expect(result.turns).toHaveLength(50);
    expect(result.turnsOmitted).toBe(4951);
    expect(result.truncated).toBe(true);
    // The opposite case to the zero-budget test: rows were dropped, but every
    // row that IS listed was analysed.
    expect(result.turnsUnanalyzed).toBe(0);
  });

  test('a normal game is not truncated and omits nothing', () => {
    const full = require('./fixtures/real-game-full.json');
    const result = solver.solveGame(full, { budgetMs: 30000 });
    expect(result.truncated).toBe(false);
    expect(result.turnsOmitted).toBe(0);
  });
});

describe('a play the solver cannot reproduce', () => {
  const impossible = {
    recordingQuality: 'full',
    players: [],
    moves: [
      {
        turn: 1,
        action: 'play',
        player: 'player-1',
        rackBefore: rack('CAT'),
        placements: spell('CAT', 7, 7, 'across'),
        words: [{ word: 'CAT', score: 999 }],
        score: 999,
      },
    ],
  };

  test('is flagged as unverified, never reported as the best play', () => {
    const result = solver.solveGame(impossible, { budgetMs: 5000 });
    const turn = result.turns[0];

    expect(turn.solved).toBe(true);
    expect(turn.best[0].score).toBeLessThan(999);
    // The old code clamped this to 0 and then called it a perfect turn.
    expect(turn.unmatchedPlay).toBe(true);
    expect(turn.pointsLeft).toBeNull();
    expect(turn.wasBest).toBeNull();
    expect(turn.wasBest).not.toBe(true);
  });

  test('an ordinary turn is not flagged and still reports its gap', () => {
    const full = require('./fixtures/real-game-full.json');
    const result = solver.solveGame(full, { budgetMs: 30000, askingAlias: 'player-1' });
    const solved = result.turns.filter((t: any) => t.solved);

    expect(solved.length).toBeGreaterThan(0);
    for (const turn of solved) {
      expect(turn.unmatchedPlay).toBe(false);
      if (turn.best.length > 0) {
        expect(turn.pointsLeft).toBeGreaterThanOrEqual(0);
        expect(turn.wasBest).toBe(turn.pointsLeft === 0);
      }
    }
  });
});

describe('a blank already on the board with no designated letter', () => {
  test('is reported as unsolvable rather than silently under-solved', () => {
    const withLetter = position([
      [
        { row: 7, col: 7, letter: 'C', value: VALUES.C },
        { row: 7, col: 8, letter: 'A', value: 0, isBlank: true },
        { row: 7, col: 9, letter: 'T', value: VALUES.T },
      ],
    ]);
    const known = solver.findBestMoves(withLetter.grid, rack('SERO'), { limit: 5 });
    expect(known.degraded).toBe(false);
    expect(known.moves.length).toBeGreaterThan(0);

    // Same position, but the blank carries no letter. Previously this zeroed the
    // cross-check column through it and quietly returned a worse "best".
    const unknown = position([
      [
        { row: 7, col: 7, letter: 'C', value: VALUES.C },
        { row: 7, col: 8, letter: '', value: 0, isBlank: true },
        { row: 7, col: 9, letter: 'T', value: VALUES.T },
      ],
    ]);
    const result = solver.findBestMoves(unknown.grid, rack('SERO'), { limit: 5 });
    expect(result.degraded).toBe(true);
    expect(result.moves).toEqual([]);
  });

  test('leaves the turn unsolved in solveGame instead of comparing scores', () => {
    const game = {
      recordingQuality: 'full',
      players: [],
      moves: [
        {
          turn: 1,
          action: 'play',
          player: 'player-1',
          placements: [
            { row: 7, col: 7, letter: 'C', value: VALUES.C },
            { row: 7, col: 8, letter: '', value: 0, isBlank: true },
            { row: 7, col: 9, letter: 'T', value: VALUES.T },
          ],
          words: [{ word: 'CAT', score: 12 }],
          score: 12,
        },
        {
          turn: 2,
          action: 'play',
          player: 'player-2',
          rackBefore: rack('SERO'),
          placements: [{ row: 6, col: 9, letter: 'S', value: VALUES.S }],
          words: [{ word: 'ST', score: 2 }],
          score: 2,
        },
      ],
    };
    const result = solver.solveGame(game, { budgetMs: 5000 });
    expect(result.turns[1].solved).toBe(false);
    expect(result.turns[1].best).toEqual([]);
    expect(result.turns[1].wasBest).toBeNull();
    // `solved: false` on its own reads as "no rack was recorded", which is
    // false here — the rack is known and the BOARD is what could not be read.
    expect(result.turns[1].unsolvableBoard).toBe(true);
    expect(result.turns[1].unanalyzed).toBeUndefined();

    // Turn 1 has no rack, so it is the other kind of unsolved.
    expect(result.turns[0].solved).toBe(false);
    expect(result.turns[0].unsolvableBoard).toBe(false);
  });
});

describe('the best list shows distinct words', () => {
  test('the first move does not degenerate into shifted copies of one word', () => {
    const full = require('./fixtures/real-game-full.json');
    const grid = solver.emptyGrid();
    const { moves } = solver.findBestMoves(grid, full.moves[0].rackBefore, { limit: 5 });

    expect(moves).toHaveLength(5);
    const words = moves.map((m: any) => m.word);
    // Was GIRT@7,7 / GIRT@7,6 / GIRT@7,5 / GIRT@7,4 / GRIT@7,7.
    expect(new Set(words).size).toBe(words.length);
  });

  test('mid-game lists are distinct by word too', () => {
    const { grid } = position([
      spell('CAT', 7, 7, 'across'),
      [
        { row: 6, col: 9, letter: 'O', value: VALUES.O },
        { row: 8, col: 9, letter: 'H', value: VALUES.H },
        { row: 9, col: 9, letter: 'E', value: VALUES.E },
      ],
    ]);
    const { moves } = solver.findBestMoves(grid, rack('SLATEN'), { limit: 5 });
    const words = moves.map((m: any) => m.word);
    expect(new Set(words).size).toBe(words.length);
  });
});
