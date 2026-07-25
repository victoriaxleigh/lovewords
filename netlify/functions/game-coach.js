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

const COACH_SYSTEM = `You are a sharp but encouraging Words With Friends coach giving a
MOVE-BY-MOVE review of a finished game.

The JSON you receive describes one game:
- "players": the two players (aliased player-1 / player-2) with displayName and finalScore.
- "moves": every turn in order. Each has "turn", "action" ('play' | 'swap' | 'pass'), "player"
  (which alias took it), and "score". Plays also carry "placements" — the tiles laid that turn,
  each with letter, value, and row/col (0-indexed on a 15x15 board) — and "words" (the word(s)
  formed with their points). In "full"-quality games, plays also include "rackBefore" (the 7 tiles
  the player held that turn) and swaps include returnedTiles/drawnTiles.
- "boardMetadata" and "rules": the 15x15 bonus-square layout (TW/DW/TL/DL/START) and WWF scoring
  (including the bingo bonus for using all 7 tiles).

Reconstruct the board as you go: replay each play's placements by row/col, in order, so you know
what the board looked like before every turn.

Then write a move-by-move review for the player known as the given alias. Go through THEIR turns in
order. For each:
- Lead with "Turn N — WORD (score)" for a play, or note a swap/pass in one line.
- Say whether it was a strong play or a missed chance.
- When a clearly better play was available FROM THE TILES THEY ACTUALLY HELD that turn (use
  rackBefore), name it: the word, roughly where it would sit on the board, and an ESTIMATED score.
  Mark estimates with "~". Only suggest plays that are legal from their rack and fit the board you
  reconstructed — never invent tiles they didn't have or plays that don't connect.
- Mention the opponent's turns only briefly, for context.
- Don't belabor small turns; when a move was already good, say so in a few words and move on.

Ground rules:
- Honest but kind — celebrate good plays, don't pile on. It's a game between partners/friends.
- Estimates are approximations, not the proven optimum — say "~" and don't claim you found the
  perfect play.
- If recordingQuality is "basic", you won't have racks/positions for every turn — give
  higher-level per-turn feedback instead of inventing specifics, and say so once up front.
- If you are not confident a specific alternative play is legal on the board you reconstructed
  and uses only tiles they held, do NOT state it. Give a general pointer instead (e.g. "a triple-
  word spot was open on the left you could have aimed for"). A correct general note always beats a
  specific but wrong one — never present a guessed word/score as fact.
- Plain, mobile-friendly text. Short per-turn lines. No Markdown headers, no code blocks.
- Finish with 2-3 overall takeaways: patterns to work on next game.`;

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
      max_tokens: 4000,
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
