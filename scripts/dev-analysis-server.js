const http = require('http');

const HOST = '127.0.0.1';
const PORT = 8088;
const PREVIEW_TOKEN = 'lw_analysis_local_preview';

const previewGame = {
  schemaVersion: 1,
  recordingQuality: 'full',
  preview: true,
  gameId: 'local-preview',
  status: 'finished',
  mode: 'partner',
  gameType: 'multiplayer',
  createdAt: '2026-07-23T20:00:00.000Z',
  finishedAt: '2026-07-23T21:00:00.000Z',
  bagCount: 0,
  boardMetadata: {
    version: 1,
    size: 15,
    coordinates: {
      base: 0,
      origin: 'top-left',
      rowDirection: 'down',
      columnDirection: 'right',
    },
  },
  rules: {
    version: 1,
    rackSize: 7,
    bingoTileCount: 7,
    bingoBonus: 35,
    consecutivePassLimit: 4,
  },
  players: [
    {
      alias: 'player-1',
      displayName: 'Dev',
      finalScore: 312,
      finalRack: [],
    },
    {
      alias: 'player-2',
      displayName: 'Player 2',
      finalScore: 287,
      finalRack: [{ letter: 'Q', value: 10 }],
    },
  ],
  moves: [
    {
      turn: 1,
      version: 2,
      action: 'play',
      player: 'player-1',
      score: 12,
      resultingScore: 12,
      timestamp: 1784851200000,
      rackBefore: [
        { letter: 'C', value: 4 },
        { letter: 'A', value: 1 },
        { letter: 'T', value: 1 },
        { letter: 'E', value: 1 },
        { letter: 'R', value: 1 },
        { letter: 'S', value: 1 },
        { letter: 'L', value: 2 },
      ],
      placements: [
        { letter: 'C', value: 4, row: 7, col: 7 },
        { letter: 'A', value: 1, row: 7, col: 8 },
        { letter: 'T', value: 1, row: 7, col: 9 },
      ],
      words: [{ word: 'CAT', score: 12 }],
      drawnTiles: [
        { letter: 'O', value: 1 },
        { letter: 'V', value: 5 },
        { letter: 'E', value: 1 },
      ],
      bagCount: 87,
    },
  ],
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  });
  response.end(JSON.stringify(body, null, 2));
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== 'GET' || request.url !== '/api/game-analysis') {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (request.headers.authorization !== `Bearer ${PREVIEW_TOKEN}`) {
    sendJson(response, 401, { error: 'Invalid local preview token' });
    return;
  }

  sendJson(response, 200, previewGame);
});

server.listen(PORT, HOST, () => {
  console.log(`LoveWords local analysis preview: http://${HOST}:${PORT}/api/game-analysis`);
});
