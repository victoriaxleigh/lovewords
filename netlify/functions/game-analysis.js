const {
  AnalysisTokenError,
  fetchAnalysisEvents,
  fetchGame,
  getServerConfig,
  jsonResponse,
  parseBearer,
  sanitizeGameExport,
  verifyAnalysisToken,
} = require('./game-analysis-common');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'GET' });
  }

  const config = getServerConfig();
  if (!config) {
    return jsonResponse(500, { error: 'Analysis export is not configured' });
  }

  const token = parseBearer(event.headers);
  if (!token) {
    return jsonResponse(401, { error: 'Missing analysis token' });
  }

  let claims;
  try {
    claims = verifyAnalysisToken(token, config.analysisSecret);
  } catch (error) {
    if (error instanceof AnalysisTokenError) {
      const message = error.code === 'expired' ? 'Analysis token has expired' : 'Invalid analysis token';
      return jsonResponse(401, { error: message });
    }
    console.error('game-analysis verification error:', error.message);
    return jsonResponse(500, { error: 'Could not verify analysis token' });
  }

  try {
    // Intentionally omit board, current_turn, and player uid columns. The export
    // is built from a strict whitelist in sanitizeGameExport.
    const game = await fetchGame(config.supabaseUrl, config.supabaseKey, claims.gid, [
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
    if (game.status !== 'finished') {
      return jsonResponse(409, { error: 'Game is not finished' });
    }

    const privateEvents = await fetchAnalysisEvents(
      config.supabaseUrl,
      config.supabaseKey,
      claims.gid
    );
    return jsonResponse(200, sanitizeGameExport(game, privateEvents));
  } catch (error) {
    console.error('game-analysis error:', error.message);
    return jsonResponse(500, { error: 'Could not export game analysis' });
  }
};
