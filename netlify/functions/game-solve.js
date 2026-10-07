const {
  fetchAnalysisEvents,
  fetchGame,
  fetchSupabaseUser,
  isUuid,
  jsonResponse,
  parseBearer,
  sanitizeGameExport,
} = require('./game-analysis-common');
const { solveGame } = require('./lib/solver');
const { capResponseSize, checkCooldown } = require('./lib/analysisLimits');
const { forAsker, readCachedSolve, writeCachedSolve } = require('./lib/solveCache');

// Netlify's synchronous execution limit is 60s (fixed, not configurable), which
// leaves plenty of room for the Supabase round trips and the cold-start trie
// build on either side of the solve.
//
// Sized against PRODUCTION speed, not a dev machine. A Lambda's vCPU is
// proportional to its memory, so the solver runs roughly 15x slower there than
// on a laptop: a 41-turn game measured 969ms locally but only reached 10 of 41
// turns inside a 6s budget on the deploy preview. Raising memory (Pro/
// Enterprise) would buy speed directly. This budget is only paid once per game:
// a complete solve is cached in `game_solutions` (see lib/solveCache.js), since
// a finished game's solution never changes.
const SOLVE_BUDGET_MS = 25000;

function gameIdFromEvent(event) {
  const fromQuery = event.queryStringParameters?.gameId;
  if (fromQuery) return fromQuery;
  const match = event.path?.match(/\/api\/games\/([^/]+)\/solve\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function serverConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }

  const config = serverConfig();
  if (!config) {
    return jsonResponse(500, { error: 'Game analysis is not configured' });
  }

  const gameId = gameIdFromEvent(event);
  if (!isUuid(gameId)) {
    return jsonResponse(400, { error: 'Invalid game ID' });
  }

  const accessToken = parseBearer(event.headers);
  if (!accessToken) {
    return jsonResponse(401, { error: 'Missing Authorization header' });
  }

  try {
    const user = await fetchSupabaseUser(config.supabaseUrl, config.supabaseKey, accessToken);
    if (!user) {
      return jsonResponse(401, { error: 'Invalid or expired session' });
    }

    // Authorize against the small, trusted column set before pulling the export.
    const guard = await fetchGame(config.supabaseUrl, config.supabaseKey, gameId, [
      'id',
      'player1_uid',
      'player2_uid',
      'status',
    ]);
    if (!guard) {
      return jsonResponse(404, { error: 'Game not found' });
    }
    if (guard.player1_uid !== user.id && guard.player2_uid !== user.id) {
      return jsonResponse(403, { error: 'You are not a player in this game' });
    }
    if (guard.status !== 'finished') {
      return jsonResponse(409, { error: 'Game is not finished' });
    }

    // Cooldown after authorization, so it cannot be used to probe games. Keyed
    // per endpoint: the client calls /solve then /coach on one press, and each
    // function is its own Lambda in production anyway.
    const cooldown = checkCooldown('solve', user.id);
    if (!cooldown.ok) {
      return jsonResponse(
        429,
        { error: 'You just ran an analysis. Give it a few seconds.' },
        { 'Retry-After': String(cooldown.retryAfterSeconds) }
      );
    }

    const askingAlias = guard.player1_uid === user.id ? 'player-1' : 'player-2';

    // A finished game's solve never changes, so a hit skips the export fetch and
    // the solver entirely. Only the asker is stamped on per request.
    const cached = await readCachedSolve(config.supabaseUrl, config.supabaseKey, gameId);
    if (cached) {
      return jsonResponse(200, capResponseSize(forAsker(cached, askingAlias)));
    }

    const game = await fetchGame(config.supabaseUrl, config.supabaseKey, gameId, [
      'id',
      'players',
      'bag',
      'status',
      'mode',
      'moves',
      'created_at',
      'updated_at',
    ]);
    if (!game) {
      return jsonResponse(404, { error: 'Game not found' });
    }
    const privateEvents = await fetchAnalysisEvents(
      config.supabaseUrl,
      config.supabaseKey,
      gameId
    );
    // Everything below is built from the sanitized export only — never the raw
    // row — so no emails or Supabase UIDs can reach the response.
    const exportData = sanitizeGameExport(game, privateEvents);

    const solve = solveGame(exportData, { askingAlias, budgetMs: SOLVE_BUDGET_MS });
    // Awaited, not fire-and-forget: a Lambda can freeze as soon as it returns.
    // A failed write is logged inside and never fails the request.
    await writeCachedSolve(config.supabaseUrl, config.supabaseKey, gameId, solve);

    return jsonResponse(200, capResponseSize(solve));
  } catch (error) {
    console.error('game-solve error:', error.message);
    return jsonResponse(500, { error: 'Could not analyze this game' });
  }
};
