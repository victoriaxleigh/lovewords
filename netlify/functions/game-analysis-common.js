const crypto = require('crypto');

const TOKEN_PREFIX = 'lw_analysis_v1';
const TOKEN_VERSION = 1;
const TOKEN_TTL_SECONDS = 60 * 60;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BOARD_METADATA = {
  version: 1,
  size: 15,
  coordinates: {
    base: 0,
    origin: 'top-left',
    rowDirection: 'down',
    columnDirection: 'right',
  },
  bonusSquares: {
    TW: [[0, 0], [0, 7], [0, 14], [7, 0], [7, 14], [14, 0], [14, 7], [14, 14]],
    DW: [
      [1, 1], [1, 13], [2, 2], [2, 12], [3, 3], [3, 11], [4, 4], [4, 10],
      [10, 4], [10, 10], [11, 3], [11, 11], [12, 2], [12, 12], [13, 1], [13, 13],
    ],
    TL: [
      [1, 5], [1, 9], [5, 1], [5, 5], [5, 9], [5, 13],
      [9, 1], [9, 5], [9, 9], [9, 13], [13, 5], [13, 9],
    ],
    DL: [
      [0, 3], [0, 11], [2, 6], [2, 8], [3, 0], [3, 7], [3, 14],
      [6, 2], [6, 6], [6, 8], [6, 12], [7, 3], [7, 11],
      [8, 2], [8, 6], [8, 8], [8, 12], [11, 0], [11, 7], [11, 14],
      [12, 6], [12, 8], [14, 3], [14, 11],
    ],
    START: [[7, 7]],
  },
};
const RULES_METADATA = {
  version: 1,
  rackSize: 7,
  bingoTileCount: 7,
  bingoBonus: 35,
  consecutivePassLimit: 4,
};

class AnalysisTokenError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AnalysisTokenError';
    this.code = code;
  }
}

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseBearer(headers = {}) {
  const header = headers.authorization || headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function base64urlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AnalysisTokenError('malformed');
  }
  const buffer = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (base64urlEncode(buffer) !== value) {
    throw new AnalysisTokenError('malformed');
  }
  return buffer;
}

function tokenSignature(payloadSegment, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${TOKEN_PREFIX}.${payloadSegment}`)
    .digest();
}

function createAnalysisToken(gameId, secret, options = {}) {
  if (!isUuid(gameId)) throw new AnalysisTokenError('invalid_game_id');
  if (!secret) throw new AnalysisTokenError('missing_secret');

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const randomBytes = options.randomBytes || crypto.randomBytes;
  const claims = {
    v: TOKEN_VERSION,
    gid: gameId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    nonce: base64urlEncode(randomBytes(16)),
  };
  const payload = base64urlEncode(JSON.stringify(claims));
  const signature = base64urlEncode(tokenSignature(payload, secret));

  return {
    token: `${TOKEN_PREFIX}.${payload}.${signature}`,
    claims,
  };
}

function verifyAnalysisToken(token, secret, options = {}) {
  if (!secret) throw new AnalysisTokenError('missing_secret');
  if (typeof token !== 'string') throw new AnalysisTokenError('malformed');

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    throw new AnalysisTokenError('malformed');
  }

  const expected = tokenSignature(parts[1], secret);
  const supplied = base64urlDecode(parts[2]);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new AnalysisTokenError('invalid_signature');
  }

  let claims;
  try {
    claims = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
  } catch (error) {
    if (error instanceof AnalysisTokenError) throw error;
    throw new AnalysisTokenError('malformed');
  }

  if (
    !claims ||
    claims.v !== TOKEN_VERSION ||
    !isUuid(claims.gid) ||
    !Number.isInteger(claims.iat) ||
    !Number.isInteger(claims.exp) ||
    claims.exp !== claims.iat + TOKEN_TTL_SECONDS ||
    typeof claims.nonce !== 'string' ||
    claims.nonce.length < 20
  ) {
    throw new AnalysisTokenError('malformed');
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (claims.iat > now + 60) throw new AnalysisTokenError('not_yet_valid');
  if (claims.exp <= now) throw new AnalysisTokenError('expired');

  return claims;
}

function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function getServerConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const analysisSecret = process.env.ANALYSIS_TOKEN_SECRET;
  if (
    !supabaseUrl ||
    !supabaseKey ||
    !analysisSecret ||
    Buffer.byteLength(analysisSecret, 'utf8') < 32
  ) {
    return null;
  }
  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), supabaseKey, analysisSecret };
}

function supabaseHeaders(supabaseKey) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };
}

async function fetchSupabaseUser(supabaseUrl, supabaseKey, accessToken) {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && isUuid(user.id) ? user : null;
}

async function fetchGame(supabaseUrl, supabaseKey, gameId, fields) {
  const query = new URLSearchParams({
    id: `eq.${gameId}`,
    select: fields.join(','),
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/games?${query}`, {
    headers: supabaseHeaders(supabaseKey),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Supabase game lookup failed (${response.status}): ${detail}`);
  }
  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function fetchAnalysisEvents(supabaseUrl, supabaseKey, gameId) {
  const query = new URLSearchParams({
    game_id: `eq.${gameId}`,
    select: 'event_index,event',
    order: 'event_index.asc',
  });
  const response = await fetch(
    `${supabaseUrl}/rest/v1/game_analysis_events?${query}`,
    { headers: supabaseHeaders(supabaseKey) }
  );
  // During a rolling deploy, an older database may not have the new table yet.
  // Degrade to a basic public-history export instead of breaking legacy games.
  if (response.status === 404) return [];
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Supabase analysis-event lookup failed (${response.status}): ${detail}`
    );
  }
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function sanitizeTile(tile, includePosition = false) {
  const result = {
    letter: typeof tile?.letter === 'string' ? tile.letter : '',
    value: Number.isFinite(tile?.value) ? tile.value : 0,
  };
  if (tile?.isBlank === true) result.isBlank = true;
  if (includePosition) {
    result.row = Number.isInteger(tile?.row) ? tile.row : null;
    result.col = Number.isInteger(tile?.col) ? tile.col : null;
  }
  return result;
}

function moveAction(move) {
  if (move?.version === 2 && ['play', 'swap', 'pass'].includes(move.action)) {
    return move.action;
  }
  if (move?.uid === 'pass') return 'pass';
  if (move?.uid === 'swap') return 'swap';
  return 'play';
}

function isCompleteV2Event(move) {
  if (
    move?.version !== 2 ||
    !['play', 'swap', 'pass'].includes(move.action) ||
    (move.playerIndex !== 0 && move.playerIndex !== 1) ||
    !Array.isArray(move.rackBefore) ||
    !Number.isInteger(move.bagCount) ||
    !Number.isFinite(move.timestamp)
  ) {
    return false;
  }
  if (move.action === 'play') {
    return (
      Array.isArray(move.placements) &&
      move.placements.length > 0 &&
      Array.isArray(move.words) &&
      Number.isFinite(move.score) &&
      Number.isFinite(move.resultingScore) &&
      Array.isArray(move.drawnTiles)
    );
  }
  if (move.action === 'swap') {
    return Array.isArray(move.returnedTiles) && Array.isArray(move.drawnTiles);
  }
  return true;
}

function hasCompleteHistoryProvenance(game) {
  return (
    Array.isArray(game?.players) &&
    game.players.length >= 2 &&
    game.players[0]?.historyVersion === 2 &&
    game.players[1]?.historyVersion === 2
  );
}

function eventValuesMatch(publicEvent, privateEvent) {
  const keys = [
    'version',
    'action',
    'playerIndex',
    'uid',
    'tiles',
    'score',
    'timestamp',
    'placements',
    'words',
    'resultingScore',
    'bagCount',
  ];
  return keys.every(
    (key) => JSON.stringify(publicEvent?.[key]) === JSON.stringify(privateEvent?.[key])
  );
}

function mergeAnalysisEvents(publicMoves, privateRows) {
  const moves = Array.isArray(publicMoves) ? publicMoves : [];
  const rows = Array.isArray(privateRows) ? privateRows : [];
  const byIndex = new Map(
    rows
      .filter((row) => Number.isInteger(row?.event_index) && row?.event)
      .map((row) => [row.event_index, row.event])
  );
  let allMatched = rows.length === moves.length && moves.length > 0;

  const mergedMoves = moves.map((publicEvent, index) => {
    const privateEvent = byIndex.get(index);
    const matched =
      privateEvent &&
      eventValuesMatch(publicEvent, privateEvent) &&
      isCompleteV2Event(privateEvent);
    if (!matched) {
      allMatched = false;
      return publicEvent;
    }

    const merged = { ...publicEvent };
    for (const key of ['rackBefore', 'drawnTiles', 'returnedTiles']) {
      if (Array.isArray(privateEvent[key])) merged[key] = privateEvent[key];
    }
    return merged;
  });

  return { moves: mergedMoves, allMatched };
}

function sanitizeGameExport(game, privateEvents = []) {
  const sourcePlayers = Array.isArray(game?.players) ? game.players.slice(0, 2) : [];
  const aliases = ['player-1', 'player-2'];
  const isSolo =
    sourcePlayers.length === 2 &&
    (sourcePlayers[1]?.email === 'solo' ||
      (sourcePlayers[0]?.uid && sourcePlayers[0].uid === sourcePlayers[1]?.uid));

  const aliasForMove = (move, index) => {
    if (move?.version === 2 && (move.playerIndex === 0 || move.playerIndex === 1)) {
      return aliases[move.playerIndex];
    }
    if (isSolo) return aliases[index % 2];
    const playerIndex = sourcePlayers.findIndex(
      (player) => player?.uid && player.uid === move?.uid
    );
    return playerIndex >= 0 ? aliases[playerIndex] : null;
  };

  const players = sourcePlayers.map((player, index) => ({
    alias: aliases[index],
    displayName:
      typeof player?.displayName === 'string' && player.displayName
        ? player.displayName
        : `Player ${index + 1}`,
    finalScore: Number.isFinite(player?.score) ? player.score : 0,
    finalRack: Array.isArray(player?.rack)
      ? player.rack.map((tile) => sanitizeTile(tile))
      : [],
  }));

  const mergedHistory = mergeAnalysisEvents(game?.moves, privateEvents);
  const sourceMoves = mergedHistory.moves;
  const moves = sourceMoves.map((move, index) => {
    const action = moveAction(move);
    const sourcePlacements =
      move?.version === 2 && Array.isArray(move.placements)
        ? move.placements
        : Array.isArray(move?.tiles)
          ? move.tiles
          : [];
    const result = {
      turn: index + 1,
      action,
      player: aliasForMove(move, index),
      score: Number.isFinite(move?.score) ? move.score : 0,
      timestamp: Number.isFinite(move?.timestamp) ? move.timestamp : null,
      placements: sourcePlacements.map((tile) => sanitizeTile(tile, true)),
    };

    if (move?.version === 2) {
      result.version = 2;
      if (Array.isArray(move.rackBefore)) {
        result.rackBefore = move.rackBefore.map((tile) => sanitizeTile(tile));
      }
      if (Array.isArray(move.words)) {
        result.words = move.words
          .filter((word) => typeof word?.word === 'string' && Number.isFinite(word?.score))
          .map((word) => ({ word: word.word, score: word.score }));
      }
      if (Number.isFinite(move.resultingScore)) {
        result.resultingScore = move.resultingScore;
      }
      if (Array.isArray(move.drawnTiles)) {
        result.drawnTiles = move.drawnTiles.map((tile) => sanitizeTile(tile));
      }
      if (Array.isArray(move.returnedTiles)) {
        result.returnedTiles = move.returnedTiles.map((tile) => sanitizeTile(tile));
      }
      if (Number.isInteger(move.bagCount)) result.bagCount = move.bagCount;
    } else if (typeof move?.word === 'string' && move.word) {
      result.word = move.word;
    }
    return result;
  });

  return {
    schemaVersion: 1,
    recordingQuality:
      hasCompleteHistoryProvenance(game) &&
      mergedHistory.allMatched &&
      sourceMoves.every(isCompleteV2Event)
        ? 'full'
        : 'basic',
    gameId: game.id,
    status: 'finished',
    mode: game.mode === 'friend' ? 'friend' : 'partner',
    gameType: isSolo ? 'solo' : 'multiplayer',
    createdAt: game.created_at || null,
    finishedAt: game.updated_at || null,
    bagCount: Array.isArray(game.bag) ? game.bag.length : 0,
    boardMetadata: BOARD_METADATA,
    rules: RULES_METADATA,
    players,
    moves,
  };
}

function publicOrigin(event) {
  if (process.env.URL) return process.env.URL.replace(/\/+$/, '');
  const headers = event.headers || {};
  const host = headers['x-forwarded-host'] || headers.host;
  const protocol = headers['x-forwarded-proto'] || 'https';
  return host ? `${protocol}://${host}` : 'http://localhost:8888';
}

module.exports = {
  AnalysisTokenError,
  TOKEN_TTL_SECONDS,
  createAnalysisToken,
  fetchAnalysisEvents,
  fetchGame,
  fetchSupabaseUser,
  getServerConfig,
  isUuid,
  jsonResponse,
  mergeAnalysisEvents,
  parseBearer,
  publicOrigin,
  sanitizeGameExport,
  verifyAnalysisToken,
};
