/**
 * Shared limits for the two analysis endpoints (`game-solve`, `game-coach`).
 *
 * Both run the solver over a player-writable `moves` array, and the coach also
 * spends real Anthropic budget per call. This is deliberately not a rate-limit
 * framework: a per-user cooldown, a response byte cap, and a prompt byte cap.
 *
 * Scope of the cooldown, precisely: it is module state, and Netlify deploys
 * each function as its own Lambda with its own module scope, so `game-solve`
 * and `game-coach` do NOT share this map in production - and even within one
 * function, several containers may run concurrently. It is a cost damper, not a
 * guarantee. It is therefore keyed per endpoint as well as per user, which is
 * the only behaviour that is correct in both worlds: in production the two
 * functions were never going to see each other's entries anyway, and in a
 * shared process (local dev, `netlify dev`, this test suite) a per-user-only
 * key would 429 the coach half of every normal "analyze" press, because the
 * client calls /solve and then /coach back to back.
 *
 * The hard bounds on the work itself are the solver's wall-clock budget and its
 * turn cap, both per-request.
 */

const { MAX_TURNS } = require('./solver');

// One analysis at a time per user per endpoint, with a short gap between them.
const COOLDOWN_MS = 10_000;

// Comfortably above a real game (~40 turns at ~1KB each) and far below the
// point where the client's unwindowed turn list stalls.
const MAX_RESPONSE_BYTES = 512 * 1024;

// The coach prompt is billed per token, so it gets its own, tighter bound. A
// real 39-turn game serializes to ~43KB; this leaves ~6x headroom and still
// caps a crafted game at roughly 73K tokens instead of an unbounded number.
const MAX_PROMPT_BYTES = 256 * 1024;

// Neutralises the <game-data> fence inside the untrusted payload. `displayName`
// is clamped to 40 characters upstream, but `</game-data>` needs only 12 - and
// the clamp is not the only player-writable string that reaches the prompt
// (`moves[].words[].word` is another), so the scrub is applied once to the
// serialized payload rather than field by field.
const DELIMITER_PATTERN = /<\s*\/?\s*game-data\s*>?/gi;

const lastRequestAt = new Map();

/**
 * Record a request for `userId` on `endpoint` and say whether it is allowed
 * through. Returns `{ ok: true }` or `{ ok: false, retryAfterSeconds }`.
 */
function checkCooldown(endpoint, userId, now = Date.now()) {
  if (!userId) return { ok: true };
  const key = `${endpoint} ${userId}`;

  // Drop expired entries so the map cannot grow without bound in a long-lived
  // container.
  for (const [id, at] of lastRequestAt) {
    if (now - at >= COOLDOWN_MS) lastRequestAt.delete(id);
  }

  const last = lastRequestAt.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) {
    return { ok: false, retryAfterSeconds: Math.ceil((COOLDOWN_MS - (now - last)) / 1000) };
  }

  lastRequestAt.set(key, now);
  return { ok: true };
}

/** Test seam - the cooldown map is module state, keyed per (endpoint, user). */
function resetCooldowns() {
  lastRequestAt.clear();
}

/**
 * Bound the serialized size of a solve response by dropping turns off the end
 * until it fits, marking the result truncated. Turns are dropped rather than
 * the request rejected so a pathological game still returns a usable table.
 */
function capResponseSize(solve, maxBytes = MAX_RESPONSE_BYTES) {
  if (!solve || !Array.isArray(solve.turns)) return solve;
  if (JSON.stringify(solve).length <= maxBytes) return solve;

  const fits = (count) =>
    JSON.stringify({ ...solve, turns: solve.turns.slice(0, count) }).length <= maxBytes;

  let lo = 0;
  let hi = solve.turns.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }

  const kept = solve.turns.slice(0, lo);
  return {
    ...solve,
    turns: kept,
    turnsOmitted: (solve.turnsOmitted || 0) + (solve.turns.length - lo),
    // Recount rather than carry the old total: a turn dropped from the list is
    // omitted, not unanalyzed, and the two get different wording on screen.
    turnsUnanalyzed: kept.filter((t) => t.unanalyzed === true).length,
    truncated: true,
  };
}

/**
 * Build the `{ game, solver }` object that goes into the coach prompt, bounded
 * in both turn count and bytes.
 *
 * `capResponseSize` only ever bounded `solver`; `game.moves` came straight from
 * the player-writable row, so a crafted game could multiply the billed prompt
 * without limit (39 real turns produce 43KB; +3,000 pass moves produce ~1MB,
 * which is still inside the model's context and therefore BILLS rather than
 * erroring). The export gets the solver's own `MAX_TURNS` cap first, then both
 * lists are trimmed in lockstep until the payload fits `maxBytes`.
 */
function capPromptPayload(game, solve, maxBytes = MAX_PROMPT_BYTES) {
  const moves = Array.isArray(game?.moves) ? game.moves : [];
  const turns = Array.isArray(solve?.turns) ? solve.turns : [];

  const build = (count) => {
    const keptMoves = count < moves.length ? moves.slice(0, count) : moves;
    const keptTurns = count < turns.length ? turns.slice(0, count) : turns;
    // What the coach is told is omitted is measured against the whole game, so
    // "truncated" stays true and the count stays honest however it got trimmed.
    const omitted = moves.length - keptTurns.length;
    return {
      game: keptMoves === moves ? game : { ...game, moves: keptMoves },
      solver: {
        ...solve,
        turns: keptTurns,
        turnsOmitted: omitted,
        turnsUnanalyzed: keptTurns.filter((t) => t && t.unanalyzed === true).length,
        truncated: Boolean(solve && solve.truncated) || omitted > 0,
      },
    };
  };

  const capped = Math.min(moves.length, MAX_TURNS);
  const payload = build(capped);
  if (JSON.stringify(payload).length <= maxBytes) return payload;

  let lo = 0;
  let hi = capped;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (JSON.stringify(build(mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}

/**
 * Serialize a prompt payload and neutralise any `<game-data>` fence hidden in
 * player-controlled text, so the untrusted block cannot close itself early.
 * `<` and `>` never appear in a JSON escape sequence and the replacement holds
 * no quote or backslash, so the result is still valid JSON.
 */
function serializePromptPayload(payload) {
  return JSON.stringify(payload).replace(DELIMITER_PATTERN, '[game-data]');
}

module.exports = {
  COOLDOWN_MS,
  MAX_PROMPT_BYTES,
  MAX_RESPONSE_BYTES,
  capPromptPayload,
  capResponseSize,
  checkCooldown,
  resetCooldowns,
  serializePromptPayload,
};
