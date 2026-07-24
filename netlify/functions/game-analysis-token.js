const {
  createAnalysisToken,
  fetchGame,
  fetchSupabaseUser,
  getServerConfig,
  isUuid,
  jsonResponse,
  parseBearer,
  publicOrigin,
} = require('./game-analysis-common');

function gameIdFromEvent(event) {
  const fromQuery = event.queryStringParameters?.gameId;
  if (fromQuery) return fromQuery;
  const match = event.path?.match(/\/api\/games\/([^/]+)\/analysis-token\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }

  const config = getServerConfig();
  if (!config) {
    return jsonResponse(500, { error: 'Analysis export is not configured' });
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
    const user = await fetchSupabaseUser(
      config.supabaseUrl,
      config.supabaseKey,
      accessToken
    );
    if (!user) {
      return jsonResponse(401, { error: 'Invalid or expired session' });
    }

    const game = await fetchGame(config.supabaseUrl, config.supabaseKey, gameId, [
      'id',
      'player1_uid',
      'player2_uid',
      'status',
    ]);
    if (!game) {
      return jsonResponse(404, { error: 'Game not found' });
    }
    if (game.player1_uid !== user.id && game.player2_uid !== user.id) {
      return jsonResponse(403, { error: 'You are not a player in this game' });
    }
    if (game.status !== 'finished') {
      return jsonResponse(409, { error: 'Game is not finished' });
    }

    const { token, claims } = createAnalysisToken(gameId, config.analysisSecret);
    const endpoint = `${publicOrigin(event)}/api/game-analysis`;
    const curl = `curl -H "Authorization: Bearer ${token}" "${endpoint}"`;

    return jsonResponse(200, {
      token,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
      endpoint,
      curl,
    });
  } catch (error) {
    console.error('game-analysis-token error:', error.message);
    return jsonResponse(500, { error: 'Could not create analysis token' });
  }
};
