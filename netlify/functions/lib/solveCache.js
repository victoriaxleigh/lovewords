/**
 * Per-game cache of the post-game solve, shared by `game-solve` and
 * `game-coach`.
 *
 * A finished game is immutable, so its solve can never go stale, and the
 * expensive part is player-independent: only `askingAlias` and each turn's
 * `isAsking` depend on who is asking. Those are stripped before a write and
 * stamped back on at read time, so there is one row per game serving both
 * endpoints and both players.
 *
 * Every function here degrades rather than throws. A failed or slow read is a
 * miss and a failed write is logged, so a broken cache means exactly the old
 * behaviour: a live solve on every request.
 */

const { supabaseHeaders } = require('../game-analysis-common');
const { SOLVER_VERSION } = require('./solver');

// The cache is an optimisation sitting in front of a 25s solve; never let a
// hung Supabase call spend that budget.
const CACHE_TIMEOUT_MS = 3000;

function solutionsUrl(supabaseUrl, params) {
  return `${supabaseUrl}/rest/v1/game_solutions?${new URLSearchParams(params)}`;
}

/**
 * Only a complete solve is worth keeping. A solve whose clock ran out would
 * pin `not_analyzed` turns onto the game forever, when the next request might
 * finish. Turns dropped by the MAX_TURNS cap are deterministic, so those are
 * fine: `truncated` with `turnsOmitted > 0` is the cap, not the clock.
 */
function isCacheable(solve) {
  return (
    Boolean(solve) &&
    Array.isArray(solve.turns) &&
    solve.turnsUnanalyzed === 0 &&
    (!solve.truncated || solve.turnsOmitted > 0)
  );
}

/** Drop the asker-specific fields so the stored row serves both players. */
function toCacheable(solve) {
  const { askingAlias, ...rest } = solve;
  return {
    ...rest,
    turns: solve.turns.map(({ isAsking, ...turn }) => turn),
  };
}

/** Stamp the asker back onto a cached solution, as `solveGame` would have. */
function forAsker(solution, askingAlias) {
  return {
    ...solution,
    askingAlias,
    turns: solution.turns.map((turn) => ({
      ...turn,
      isAsking: askingAlias ? turn.player === askingAlias : false,
    })),
  };
}

function isUsableSolution(solution) {
  return (
    Boolean(solution) &&
    typeof solution === 'object' &&
    Array.isArray(solution.turns) &&
    Array.isArray(solution.players)
  );
}

/**
 * The cached, asker-free solution for `gameId`, or null on a miss. A row from
 * an older solver, a malformed row, a missing table (404 during a rolling
 * deploy) and any network or Supabase error all count as a miss.
 */
async function readCachedSolve(supabaseUrl, supabaseKey, gameId) {
  try {
    const response = await fetch(
      solutionsUrl(supabaseUrl, {
        game_id: `eq.${gameId}`,
        select: 'solution,solver_version',
        limit: '1',
      }),
      {
        headers: supabaseHeaders(supabaseKey),
        signal: AbortSignal.timeout(CACHE_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      if (response.status !== 404) {
        console.error(`game_solutions read failed (${response.status})`);
      }
      return null;
    }
    const rows = await response.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || row.solver_version !== SOLVER_VERSION) return null;
    return isUsableSolution(row.solution) ? row.solution : null;
  } catch (error) {
    console.error('game_solutions read failed:', error.message);
    return null;
  }
}

/**
 * Store a complete solve for `gameId`, replacing any row from an older solver.
 * Returns whether a row was written; never throws.
 */
async function writeCachedSolve(supabaseUrl, supabaseKey, gameId, solve) {
  if (!isCacheable(solve)) return false;
  try {
    const response = await fetch(solutionsUrl(supabaseUrl, { on_conflict: 'game_id' }), {
      method: 'POST',
      headers: {
        ...supabaseHeaders(supabaseKey),
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        game_id: gameId,
        solution: toCacheable(solve),
        solver_version: SOLVER_VERSION,
      }),
      signal: AbortSignal.timeout(CACHE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`game_solutions write failed (${response.status})`);
      return false;
    }
    return true;
  } catch (error) {
    console.error('game_solutions write failed:', error.message);
    return false;
  }
}

module.exports = {
  CACHE_TIMEOUT_MS,
  forAsker,
  isCacheable,
  readCachedSolve,
  toCacheable,
  writeCachedSolve,
};
