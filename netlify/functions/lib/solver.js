/**
 * Deterministic Words With Friends move generator.
 *
 * Plain CommonJS and self-contained: the functions bundle runs under the `nft`
 * bundler and cannot consume the TypeScript engine. `scorePlay` below is a
 * deliberate duplicate of `src/engine/scoring.ts`; `__tests__/solver.test.ts`
 * pins the two implementations together so they cannot drift.
 */

const { TERMINAL, getTrie, isValidWord } = require('./dictionary');

const SIZE = 15;
const CENTER = 7 * SIZE + 7;
const BINGO_TILE_COUNT = 7;
const BINGO_BONUS = 35;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ALL_LETTERS_MASK = (1 << 26) - 1;

// A real game is ~40 turns; the longest fixture is 43. `games.moves` is
// player-writable with no length cap upstream (supabase_schema.sql only checks
// that it is an array), so bound the work and the response body here.
const MAX_TURNS = 300;

// One definition of the board on the server: reuse the layout the sanitized
// export already publishes rather than hand-copying it a third time.
const { BOARD_METADATA } = require('../game-analysis-common');

const BONUS = (() => {
  const cells = new Array(SIZE * SIZE).fill(null);
  for (const [bonus, squares] of Object.entries(BOARD_METADATA.bonusSquares)) {
    for (const [row, col] of squares) cells[row * SIZE + col] = bonus;
  }
  return cells;
})();

function emptyGrid() {
  return new Array(SIZE * SIZE).fill(null);
}

// ─── Budget ──────────────────────────────────────────────────────────────────

/**
 * A wall-clock budget shared by every `findBestMoves` call in one solve.
 *
 * The counter has to live out here rather than inside `findBestMoves`: a game
 * of cheap turns never reaches the sampling interval within any single call, so
 * a per-call counter resets before it ever looks at the clock and the budget is
 * silently never enforced.
 */
function makeClock(deadline) {
  let counter = 0;
  return {
    deadline,
    expired: false,
    // Checking the clock on every DFS node would dominate the run; sample it,
    // but sample across the whole solve rather than per call.
    check() {
      if (this.expired) return true;
      if (++counter % 2048 !== 0) return false;
      if (Date.now() < this.deadline) return false;
      this.expired = true;
      return true;
    },
    // An unsampled, unconditional check for the coarse per-turn boundary.
    expiredNow() {
      if (this.expired) return true;
      if (Date.now() < this.deadline) return false;
      this.expired = true;
      return true;
    },
  };
}

// A tile whose letter is unknown — a blank placed on the board with no
// designated letter. Nothing can be solved around it: `extractWord` and
// `crossCheckMasks` substitute a character that matches no trie edge, which
// silently zeroes that cross-check column and under-solves the position.
function hasUnknownLetters(grid) {
  for (const cell of grid) {
    if (cell && !cell.letter) return true;
  }
  return false;
}

// ─── Scoring — mirror of src/engine/scoring.ts ───────────────────────────────

// Walks the contiguous run through (row, col) in one direction. Bonus squares
// only count for tiles in `newSet`; a premium already covered by an earlier
// turn contributes the bare tile value.
function extractWord(grid, newSet, row, col, dRow, dCol) {
  let r = row;
  let c = col;
  while (
    r - dRow >= 0 && r - dRow < SIZE &&
    c - dCol >= 0 && c - dCol < SIZE &&
    grid[(r - dRow) * SIZE + (c - dCol)]
  ) {
    r -= dRow;
    c -= dCol;
  }

  let word = '';
  let score = 0;
  let wordMultiplier = 1;
  while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) {
    const idx = r * SIZE + c;
    const tile = grid[idx];
    if (!tile) break;

    let letterVal = tile.value;
    if (newSet.has(idx)) {
      const bonus = BONUS[idx];
      if (bonus === 'DL') letterVal *= 2;
      else if (bonus === 'TL') letterVal *= 3;
      else if (bonus === 'DW' || bonus === 'START') wordMultiplier *= 2;
      else if (bonus === 'TW') wordMultiplier *= 3;
    }

    // A tile with no known letter (a boarded blank with nothing designated)
    // becomes '?', which is in no word — so the play fails validation rather
    // than scoring as something it is not. `findBestMoves` refuses such a
    // position outright; this is the backstop for direct callers.
    word += tile.letter || '?';
    score += letterVal;
    r += dRow;
    c += dCol;
  }

  if (word.length <= 1) return null;
  return { word, score: score * wordMultiplier };
}

/**
 * Score a play. Mutates `grid` while it works and restores it before returning.
 * The 35-point bingo bonus lives at the play level, not inside any word score —
 * so `total` and `sum(words[].score)` differ by 35 on a bingo turn, exactly as
 * `scoreMove` behaves.
 */
function scorePlay(grid, placements) {
  const newSet = new Set();
  const previous = new Map();
  for (const p of placements) {
    const idx = p.row * SIZE + p.col;
    newSet.add(idx);
    if (!previous.has(idx)) previous.set(idx, grid[idx]);
    grid[idx] = { letter: p.letter, value: p.value, isBlank: p.isBlank === true };
  }

  const words = [];
  let sameRow = true;
  let sameCol = true;
  for (const p of placements) {
    if (p.row !== placements[0].row) sameRow = false;
    if (p.col !== placements[0].col) sameCol = false;
  }

  if (sameRow && sameCol) {
    // Single tile — check both directions independently, no double counting.
    const h = extractWord(grid, newSet, placements[0].row, placements[0].col, 0, 1);
    if (h) words.push(h);
    const v = extractWord(grid, newSet, placements[0].row, placements[0].col, 1, 0);
    if (v) words.push(v);
  } else if (sameRow) {
    const main = extractWord(grid, newSet, placements[0].row, placements[0].col, 0, 1);
    if (main) words.push(main);
    for (const p of placements) {
      const cross = extractWord(grid, newSet, p.row, p.col, 1, 0);
      if (cross) words.push(cross);
    }
  } else if (sameCol) {
    const main = extractWord(grid, newSet, placements[0].row, placements[0].col, 1, 0);
    if (main) words.push(main);
    for (const p of placements) {
      const cross = extractWord(grid, newSet, p.row, p.col, 0, 1);
      if (cross) words.push(cross);
    }
  }

  for (const [idx, tile] of previous) grid[idx] = tile;

  const bingoBonus = placements.length === BINGO_TILE_COUNT ? BINGO_BONUS : 0;
  const total = words.reduce((sum, w) => sum + w.score, 0) + bingoBonus;
  return { total, words };
}

// ─── Legality ────────────────────────────────────────────────────────────────

/**
 * Full WWF legality check, independent of how the play was generated: one line,
 * no gaps, empty target cells, connected (or covering the star on move one),
 * and every formed word — main and cross — in the dictionary.
 */
function isLegalPlay(grid, placements, isFirstMove) {
  if (!Array.isArray(placements) || placements.length === 0) return false;

  const seen = new Set();
  for (const p of placements) {
    if (!Number.isInteger(p.row) || !Number.isInteger(p.col)) return false;
    if (p.row < 0 || p.row >= SIZE || p.col < 0 || p.col >= SIZE) return false;
    const idx = p.row * SIZE + p.col;
    if (grid[idx]) return false;
    if (seen.has(idx)) return false;
    seen.add(idx);
  }

  const sameRow = placements.every((p) => p.row === placements[0].row);
  const sameCol = placements.every((p) => p.col === placements[0].col);
  if (!sameRow && !sameCol) return false;

  // No gaps: every square between the extremes is either placed now or already
  // holds a tile.
  const dRow = sameRow ? 0 : 1;
  const dCol = sameRow ? 1 : 0;
  const positions = placements.map((p) => (sameRow ? p.col : p.row));
  const lo = Math.min(...positions);
  const hi = Math.max(...positions);
  const fixed = sameRow ? placements[0].row : placements[0].col;
  for (let i = lo; i <= hi; i++) {
    const row = dRow ? i : fixed;
    const col = dRow ? fixed : i;
    const idx = row * SIZE + col;
    if (!seen.has(idx) && !grid[idx]) return false;
  }

  if (isFirstMove) {
    if (!seen.has(CENTER)) return false;
  } else {
    const touches = placements.some((p) =>
      [[p.row - 1, p.col], [p.row + 1, p.col], [p.row, p.col - 1], [p.row, p.col + 1]].some(
        ([r, c]) =>
          r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r * SIZE + c]
      )
    );
    if (!touches) return false;
  }

  const { words } = scorePlay(grid, placements);
  if (words.length === 0) return false;
  return words.every((w) => isValidWord(w.word));
}

// ─── Cross-checks ────────────────────────────────────────────────────────────

// For each empty square, the bitmask of letters that form a legal word in the
// perpendicular direction. `dRow/dCol` is the direction the main word runs.
function crossCheckMasks(grid, dRow, dCol) {
  const trie = getTrie();
  const masks = new Array(SIZE * SIZE).fill(ALL_LETTERS_MASK);
  // The cross word runs perpendicular to the main word.
  const cRow = dCol;
  const cCol = dRow;

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const idx = row * SIZE + col;
      if (grid[idx]) continue;

      let prefix = '';
      let r = row - cRow;
      let c = col - cCol;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r * SIZE + c]) {
        // '?' matches no trie edge, so an unknown letter zeroes this column's
        // mask rather than admitting words that may not be legal. That is a
        // silent under-solve, which is why `findBestMoves` rejects a grid with
        // unknown letters before it gets here.
        prefix = (grid[r * SIZE + c].letter || '?') + prefix;
        r -= cRow;
        c -= cCol;
      }

      let suffix = '';
      r = row + cRow;
      c = col + cCol;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && grid[r * SIZE + c]) {
        suffix += grid[r * SIZE + c].letter || '?';
        r += cRow;
        c += cCol;
      }

      // No perpendicular neighbours means no cross word to satisfy.
      if (!prefix && !suffix) continue;

      let mask = 0;
      for (let i = 0; i < 26; i++) {
        let node = trie;
        let ok = true;
        for (const letter of prefix + LETTERS[i] + suffix) {
          node = node[letter];
          if (!node) { ok = false; break; }
        }
        if (ok && node[TERMINAL] === true) mask |= 1 << i;
      }
      masks[idx] = mask;
    }
  }
  return masks;
}

function anchorSquares(grid) {
  const anchors = new Set();
  let occupied = false;
  for (let idx = 0; idx < grid.length; idx++) {
    if (grid[idx]) { occupied = true; continue; }
    const row = Math.floor(idx / SIZE);
    const col = idx % SIZE;
    const adjacent =
      (row > 0 && grid[idx - SIZE]) ||
      (row < SIZE - 1 && grid[idx + SIZE]) ||
      (col > 0 && grid[idx - 1]) ||
      (col < SIZE - 1 && grid[idx + 1]);
    if (adjacent) anchors.add(idx);
  }
  // Empty board: the only playable square is the centre star.
  if (!occupied) anchors.add(CENTER);
  return anchors;
}

// ─── Rack ────────────────────────────────────────────────────────────────────

function buildRack(tiles) {
  const counts = new Array(26).fill(0);
  const values = new Array(26).fill(0);
  let blanks = 0;
  for (const tile of tiles || []) {
    if (tile?.isBlank === true || !tile?.letter) {
      blanks++;
      continue;
    }
    const letter = String(tile.letter).toUpperCase();
    const i = letter.charCodeAt(0) - 65;
    if (i < 0 || i > 25) continue;
    counts[i]++;
    // Tile values are fixed per letter in WWF, so the last one wins harmlessly.
    values[i] = Number.isFinite(tile.value) ? tile.value : 0;
  }
  return { counts, values, blanks };
}

// ─── Generation ──────────────────────────────────────────────────────────────

/**
 * Enumerate every legal play from `rackTiles` on `grid` and return the top
 * `limit` by score, de-duplicated by (word, row, col, direction).
 *
 * Anchor-based generation: from each anchor square, build the part of the word
 * to its left/above out of rack tiles, then extend right/down through existing
 * tiles and rack tiles, pruning on the trie the moment a prefix is dead.
 */
function findBestMoves(grid, rackTiles, options = {}) {
  const limit = options.limit ?? 5;
  // The clock is passed in by `solveGame` so one budget spans every turn.
  const clock = options.clock ?? makeClock(options.deadline ?? Infinity);
  const trie = getTrie();
  const rack = buildRack(rackTiles);
  const rackSize = rack.counts.reduce((a, b) => a + b, 0) + rack.blanks;
  if (rackSize === 0) return { moves: [], truncated: false, degraded: false };

  // A board tile with no known letter makes every cross-check through it wrong.
  // Report the position as unsolvable instead of quietly returning a short list
  // that would then be compared against the played score.
  if (hasUnknownLetters(grid)) {
    return { moves: [], truncated: false, degraded: true };
  }

  const anchors = anchorSquares(grid);
  const isFirstMove = grid.every((cell) => !cell);
  // The empty board is symmetric, so horizontal generation alone covers it.
  const directions = isFirstMove ? [[0, 1]] : [[0, 1], [1, 0]];

  // Keyed by the physical play (squares + letters + blank assignment) so a
  // single-tile play that forms a word in both directions is only counted once.
  const bySignature = new Map();
  const placed = [];
  let truncated = false;

  function outOfTime() {
    if (!clock.check()) return false;
    truncated = true;
    return true;
  }

  function record(word, row, col, dRow, dCol) {
    const signature = placed
      .map((p) => `${p.row * SIZE + p.col}${p.letter}${p.isBlank ? '*' : ''}`)
      .sort()
      .join(',');
    if (bySignature.has(signature)) return;
    if (!isLegalPlay(grid, placed, isFirstMove)) return;
    const { total, words } = scorePlay(grid, placed);
    bySignature.set(signature, {
      word,
      score: total,
      row,
      col,
      direction: dRow ? 'down' : 'across',
      words,
      placements: placed.map((p) => ({ ...p })),
    });
  }

  function generateFrom(anchorIdx, dRow, dCol, masks) {
    const anchorRow = Math.floor(anchorIdx / SIZE);
    const anchorCol = anchorIdx % SIZE;

    function extendRight(word, node, row, col, startRow, startCol) {
      if (truncated) return;
      const inBounds = row >= 0 && row < SIZE && col >= 0 && col < SIZE;
      const idx = inBounds ? row * SIZE + col : -1;
      const tile = inBounds ? grid[idx] : null;

      if (!tile) {
        // A word only ends where the board does or the next square is empty.
        if (node[TERMINAL] === true && placed.length > 0 && word.length > 1) {
          record(word, startRow, startCol, dRow, dCol);
        }
        if (!inBounds) return;
        if (outOfTime()) return;

        const mask = masks[idx];
        for (let i = 0; i < 26; i++) {
          if (!(mask & (1 << i))) continue;
          const letter = LETTERS[i];
          const next = node[letter];
          if (!next) continue;

          if (rack.counts[i] > 0) {
            rack.counts[i]--;
            placed.push({ row, col, letter, value: rack.values[i], isBlank: false });
            extendRight(word + letter, next, row + dRow, col + dCol, startRow, startCol);
            placed.pop();
            rack.counts[i]++;
          }
          // A blank can stand in for any letter and always scores 0. Worth
          // trying even when a real tile exists: the real tile may be worth
          // more on a different square of the same word.
          if (rack.blanks > 0) {
            rack.blanks--;
            placed.push({ row, col, letter, value: 0, isBlank: true });
            extendRight(word + letter, next, row + dRow, col + dCol, startRow, startCol);
            placed.pop();
            rack.blanks++;
          }
        }
        return;
      }

      const letter = tile.letter || '?';
      const next = node[letter];
      if (next) {
        extendRight(word + letter, next, row + dRow, col + dCol, startRow, startCol);
      }
    }

    // Squares immediately before the anchor that already hold tiles form a
    // fixed prefix; the play is then generated only from this anchor.
    const prevRow = anchorRow - dRow;
    const prevCol = anchorCol - dCol;
    const hasPrefix =
      prevRow >= 0 && prevRow < SIZE && prevCol >= 0 && prevCol < SIZE &&
      grid[prevRow * SIZE + prevCol];

    if (hasPrefix) {
      let r = prevRow;
      let c = prevCol;
      while (
        r - dRow >= 0 && r - dRow < SIZE && c - dCol >= 0 && c - dCol < SIZE &&
        grid[(r - dRow) * SIZE + (c - dCol)]
      ) {
        r -= dRow;
        c -= dCol;
      }
      let word = '';
      let node = trie;
      let rr = r;
      let cc = c;
      while (rr !== anchorRow || cc !== anchorCol) {
        const letter = grid[rr * SIZE + cc].letter || '?';
        node = node[letter];
        if (!node) return;
        word += letter;
        rr += dRow;
        cc += dCol;
      }
      extendRight(word, node, anchorRow, anchorCol, r, c);
      return;
    }

    // Otherwise the left part is built from rack tiles over the empty,
    // non-anchor squares before the anchor — the limit keeps each play from
    // being generated once per anchor it happens to span.
    let limitLeft = 0;
    let r = anchorRow - dRow;
    let c = anchorCol - dCol;
    while (
      r >= 0 && r < SIZE && c >= 0 && c < SIZE &&
      !grid[r * SIZE + c] && !anchors.has(r * SIZE + c) &&
      limitLeft < rackSize - 1
    ) {
      limitLeft++;
      r -= dRow;
      c -= dCol;
    }

    // The left part is a prefix, so it has to be built forwards from the root:
    // fix its length first, start that many squares back, and fill toward the
    // anchor. Growing it backwards would walk the trie in the wrong direction.
    function leftPart(word, node, row, col, remaining, startRow, startCol) {
      if (truncated) return;
      if (remaining === 0) {
        extendRight(word, node, anchorRow, anchorCol, startRow, startCol);
        return;
      }
      if (outOfTime()) return;

      for (let i = 0; i < 26; i++) {
        const letter = LETTERS[i];
        const next = node[letter];
        if (!next) continue;
        // Left-part squares are empty and non-anchor, which means they have no
        // adjacent tiles at all — so no cross-word can be formed there.
        if (rack.counts[i] > 0) {
          rack.counts[i]--;
          placed.push({ row, col, letter, value: rack.values[i], isBlank: false });
          leftPart(word + letter, next, row + dRow, col + dCol, remaining - 1, startRow, startCol);
          placed.pop();
          rack.counts[i]++;
        }
        if (rack.blanks > 0) {
          rack.blanks--;
          placed.push({ row, col, letter, value: 0, isBlank: true });
          leftPart(word + letter, next, row + dRow, col + dCol, remaining - 1, startRow, startCol);
          placed.pop();
          rack.blanks++;
        }
      }
    }

    for (let length = 0; length <= limitLeft; length++) {
      const startRow = anchorRow - length * dRow;
      const startCol = anchorCol - length * dCol;
      leftPart('', trie, startRow, startCol, length, startRow, startCol);
      if (truncated) break;
    }
  }

  for (const [dRow, dCol] of directions) {
    const masks = crossCheckMasks(grid, dRow, dCol);
    for (const anchorIdx of anchors) {
      generateFrom(anchorIdx, dRow, dCol, masks);
      if (truncated) break;
    }
    if (truncated) break;
  }

  // Highest score first, then collapse to one entry per word. Keying on
  // (word, row, col, direction) let an open board degenerate into shifted
  // copies of one word — the first move of a real game returned GIRT four
  // times in a five-slot list. Sorting puts the best-scoring placement of each
  // word in front, so keeping the first occurrence keeps the right one.
  const ranked = [...bySignature.values()].sort(
    (a, b) => b.score - a.score || a.word.localeCompare(b.word)
  );
  const seenWords = new Set();
  const moves = [];
  for (const move of ranked) {
    if (seenWords.has(move.word)) continue;
    seenWords.add(move.word);
    moves.push(move);
    if (moves.length >= limit) break;
  }
  return { moves, truncated, degraded: false };
}

// ─── Game replay ─────────────────────────────────────────────────────────────

function applyPlacements(grid, placements) {
  for (const p of placements || []) {
    if (!Number.isInteger(p.row) || !Number.isInteger(p.col)) continue;
    if (p.row < 0 || p.row >= SIZE || p.col < 0 || p.col >= SIZE) continue;
    // An empty `letter` means the tile's letter is unknown — a blank placed
    // with nothing designated. It is preserved as-is rather than guessed at;
    // `hasUnknownLetters` finds it and the position is reported unsolvable.
    grid[p.row * SIZE + p.col] = {
      letter: typeof p.letter === 'string' ? p.letter : '',
      value: Number.isFinite(p.value) ? p.value : 0,
      isBlank: p.isBlank === true,
    };
  }
}

/**
 * Replay a sanitized game export turn by turn and solve each position against
 * the board as it actually stood before that turn. Turns with no recorded
 * `rackBefore` come back unsolved rather than guessed at.
 */
function solveGame(exportData, options = {}) {
  const budgetMs = options.budgetMs ?? 7000;
  const limit = options.limit ?? 5;
  const maxTurns = options.maxTurns ?? MAX_TURNS;
  const askingAlias = options.askingAlias ?? null;
  const start = options.now ?? Date.now();
  const deadline = start + budgetMs;
  const clock = makeClock(deadline);

  const grid = emptyGrid();
  const turns = [];
  let truncated = false;
  // Turns that ARE in the response but carry no solver verdict because the
  // clock ran out. Distinct from `turnsOmitted`, which counts turns dropped
  // from the list entirely — the two read very differently to a player.
  let turnsUnanalyzed = 0;

  const allMoves = exportData?.moves || [];
  // A turn count cap bounds the response body and the work, independently of
  // the clock: `moves` is player-writable and has no length limit upstream.
  const consideredMoves = allMoves.length > maxTurns ? allMoves.slice(0, maxTurns) : allMoves;
  const turnsOmitted = allMoves.length - consideredMoves.length;

  for (const move of consideredMoves) {
    // Enforce the budget at the turn boundary too. The DFS sampler alone never
    // fires on a game of cheap turns, so without this the budget is unenforced
    // across the solve however long it runs.
    if (!truncated && clock.expiredNow()) truncated = true;

    // Legacy v1 history records no words[], so recover the labels from the board
    // as it stood before the move — otherwise every row of a legacy game's table
    // renders as a dash. `scorePlay` restores the grid it borrows.
    let playedWords = (move.words || []).map((w) => w.word);
    if (
      move.action === 'play' &&
      playedWords.length === 0 &&
      Array.isArray(move.placements) &&
      move.placements.length > 0
    ) {
      try {
        playedWords = scorePlay(grid, move.placements).words.map((w) => w.word);
      } catch {
        playedWords = [];
      }
    }

    const played =
      move.action === 'play'
        ? {
            word: playedWords.join(' / ') || null,
            score: Number.isFinite(move.score) ? move.score : 0,
          }
        : null;

    const entry = {
      turn: move.turn,
      player: move.player,
      isAsking: askingAlias ? move.player === askingAlias : false,
      action: move.action,
      played,
      solved: false,
      best: [],
      pointsLeft: null,
      wasBest: null,
      // The solver enumerated the position but could not reproduce a play that
      // outscored everything it found. That is an anomaly, not an achievement.
      unmatchedPlay: false,
      // The board itself could not be read — a blank on it has no designated
      // letter. `solved: false` alone would be read as "no rack data", which is
      // a different and much more common thing.
      unsolvableBoard: false,
    };

    const rackBefore = Array.isArray(move.rackBefore) ? move.rackBefore : null;
    if (rackBefore && rackBefore.length > 0) {
      if (truncated) {
        // The budget is already spent: this turn is in the table but carries no
        // verdict. Flag it per turn so the count survives a later trim, and so
        // the client can say how many rather than gesturing at "later turns".
        entry.unanalyzed = true;
        turnsUnanalyzed++;
      } else {
        const result = findBestMoves(grid, rackBefore, { limit, clock });
        if (result.truncated) {
          truncated = true;
          entry.unanalyzed = true;
          turnsUnanalyzed++;
        } else if (result.degraded) {
          // A blank on the board with no designated letter: the position cannot
          // be read at all, which is not the same as having no rack.
          entry.unsolvableBoard = true;
        } else {
          entry.solved = true;
          entry.best = result.moves.map((m) => ({
            word: m.word,
            score: m.score,
            row: m.row,
            col: m.col,
            direction: m.direction,
          }));
          if (entry.best.length > 0) {
            const playedScore = played ? played.score : 0;
            const bestScore = entry.best[0].score;
            if (played && bestScore < playedScore) {
              // Never claim "you found the best play" when what actually
              // happened is that the solver failed to find the play that was
              // made. Leave the comparison undefined and flag it so the UI and
              // the coach report it as unverified rather than as a win.
              entry.pointsLeft = null;
              entry.wasBest = null;
              entry.unmatchedPlay = true;
            } else {
              entry.pointsLeft = bestScore - playedScore;
              entry.wasBest = entry.pointsLeft === 0;
            }
          }
        }
      }
    }

    turns.push(entry);
    if (move.action === 'play') applyPlacements(grid, move.placements);
  }

  return {
    recordingQuality: exportData?.recordingQuality ?? 'basic',
    askingAlias,
    truncated: truncated || turnsOmitted > 0,
    // Two different things, reported separately: turns not in this list at all,
    // and turns in the list that never got solved because the clock expired.
    turnsOmitted,
    turnsUnanalyzed,
    players: (exportData?.players || []).map((p) => ({
      alias: p.alias,
      displayName: p.displayName,
      finalScore: p.finalScore,
    })),
    turns,
  };
}

module.exports = {
  BONUS,
  MAX_TURNS,
  SIZE,
  applyPlacements,
  emptyGrid,
  findBestMoves,
  isLegalPlay,
  scorePlay,
  solveGame,
};
