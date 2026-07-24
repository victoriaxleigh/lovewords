const Anthropic = require('@anthropic-ai/sdk');
const {
  fetchAnalysisEvents,
  fetchGame,
  fetchSupabaseUser,
  isUuid,
  jsonResponse,
  parseBearer,
  sanitizeGameExport,
} = require('./game-analysis-common');

// Which model writes the coaching. Haiku is the cheapest and fastest — a good
// fit for a short, casual coaching note. If you switch to a newer model
// (claude-sonnet-5 / claude-opus-5) you can also add `thinking: {type:
// 'adaptive'}` and `output_config: {effort: 'low'}` to the create() call below;
// Haiku 4.5 rejects both of those params, so they're omitted here.
const COACH_MODEL = 'claude-haiku-4-5';

const COACH_SYSTEM = `You are a warm, encouraging Words With Friends coach reviewing a finished game.
You receive a sanitized JSON record of one game: the two players (aliased player-1 / player-2
with their display names and final scores), and every move in order with the word(s) played and
the points each scored. "placements" are the tiles a player laid down that turn; a 7-tile play is
a bingo (bonus points). recordingQuality "basic" means some detail is missing — never invent moves,
racks, or words that aren't in the data.

Write a short, friendly coaching note for the player reading it (address them as "you" — they are
whichever player the request is about; if unclear, coach both warmly). Cover, briefly:
- The standout play of the game (highest-scoring word or a clever bingo), by name and points.
- One or two concrete things that went well.
- One gentle, specific tip for next time, grounded in what actually happened.

Keep it to 3-5 short sentences or a few tight bullet points. Plain, mobile-friendly text — no
Markdown headers, no code blocks. Encouraging in tone, never harsh. This is a fun game between
partners or friends, not a tournament.`;

function gameIdFromEvent(event) {
  const fromQuery = event.queryStringParameters?.gameId;
  if (fromQuery) return fromQuery;
  const match = event.path?.match(/\/api\/games\/([^/]+)\/coach\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function serverConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !supabaseKey || !anthropicKey) return null;
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey, anthropicKey };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }

  const config = serverConfig();
  if (!config) {
    return jsonResponse(500, { error: 'AI coaching is not configured' });
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

    // Same sanitized export the analysis endpoint produces — never the raw row.
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
    const exportData = sanitizeGameExport(game, privateEvents);

    // Tell the coach which player is asking, so "you" lands on the right side.
    const askingAlias =
      guard.player1_uid === user.id ? 'player-1' : 'player-2';

    const client = new Anthropic({ apiKey: config.anthropicKey });
    const message = await client.messages.create({
      model: COACH_MODEL,
      max_tokens: 2000,
      system: COACH_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Coach the player known as "${askingAlias}". Here is the finished game:\n\n` +
            JSON.stringify(exportData),
        },
      ],
    });

    if (message.stop_reason === 'refusal') {
      return jsonResponse(502, { error: 'The coach could not analyze this game.' });
    }

    const analysis = (message.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!analysis) {
      return jsonResponse(502, { error: 'The coach returned an empty analysis.' });
    }

    return jsonResponse(200, { analysis, recordingQuality: exportData.recordingQuality });
  } catch (error) {
    console.error('game-coach error:', error.message);
    return jsonResponse(500, { error: 'Could not generate game coaching' });
  }
};
