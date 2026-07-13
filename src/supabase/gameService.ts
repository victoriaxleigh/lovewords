import { supabase } from './config';
import { Game, Player, PlacedTile, LoveNote, Move } from '../types';
import { createEmptyBoard, applyMoveToBoard } from '../engine/board';
import { createTileBag, drawTiles, shuffle } from '../engine/tiles';
import { scoreMove } from '../engine/scoring';
import { FUNCTIONS_BASE } from '../utils/apiBase';

// Game ends after this many consecutive passes (2 each in a 2-player game).
// Covers the "stuck" case where neither player has a valid play.
const CONSECUTIVE_PASS_LIMIT = 4;

function trailingPassCount(moves: Move[]): number {
  let count = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].uid === 'pass') count++;
    else break;
  }
  return count;
}

// ─── Push Notifications ───────────────────────────────────────────────────────
// Calls our Netlify serverless function, which sends a Web Push (browser) and/or
// Expo push (native) notification depending on which subscription the recipient
// has on file. Fails silently — a notification error should never break a move.
function sendPushNotification(
  recipientUid: string,
  senderName: string,
  type: 'turn' | 'lovenote' | 'nudge'
) {
  fetch(`${FUNCTIONS_BASE}/.netlify/functions/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipientUid, senderName, type }),
  }).catch(() => {}); // never throw — notifications are best-effort
}

// ─── Nudge ────────────────────────────────────────────────────────────────────
// Poke your partner when it's their turn and they're taking their sweet time.
// Best-effort push only — no DB write, no game-state change.
export function sendNudge(recipientUid: string, senderName: string) {
  sendPushNotification(recipientUid, senderName, 'nudge');
}

// ─── Create Solo Practice Game ────────────────────────────────────────────────
// Solo games NEVER change current_turn — it stays as the real user's UID forever.
// Whose turn it is gets tracked by moves.length % 2 (even = player 1, odd = player 2).
// Both players share the same uid so no fake UUID ever lands in the uuid column.
// Solo games are identified by players[1].email === 'solo'.
export async function createSoloGame(player: Player): Promise<string> {
  const bag = createTileBag();
  const { drawn: rack1, remaining: bag2 } = drawTiles(bag, 7);
  const { drawn: rack2, remaining: finalBag } = drawTiles(bag2, 7);

  const payload = {
    player1_uid: player.uid,
    player2_uid: player.uid,
    players: [
      { ...player, rack: rack1, score: 0 },
      { uid: player.uid, displayName: 'Player 2 🎯', email: 'solo', rack: rack2, score: 0 },
    ],
    board: createEmptyBoard(),
    bag: finalBag,
    current_turn: player.uid, // stays myUid forever — turn tracked by moves.length
    status: 'active',
    moves: [],
  };

  const { data, error } = await supabase.from('games').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

// ─── Solo: Submit Move ────────────────────────────────────────────────────────
// playerIndex: 0 = player 1, 1 = player 2 (derived from moves.length % 2)
// current_turn is intentionally NOT updated — it stays as myUid forever.
export async function submitSoloMove(
  gameId: string,
  game: Game,
  playerIndex: number,
  placedTiles: PlacedTile[]
): Promise<{ success: boolean; error?: string }> {
  const { total } = scoreMove(game.board, placedTiles);
  const newBoard = applyMoveToBoard(game.board, placedTiles);

  const usedIds = new Set(placedTiles.map((t) => t.id));
  const remainingRack = game.players[playerIndex].rack.filter((t) => !usedIds.has(t.id));
  const { drawn, remaining: newBag } = drawTiles(game.bag, placedTiles.length);
  const newRack = [...remainingRack, ...drawn];

  const updatedPlayers = [...game.players] as [Player, Player];
  updatedPlayers[playerIndex] = {
    ...updatedPlayers[playerIndex],
    score: updatedPlayers[playerIndex].score + total,
    rack: newRack,
  };

  const move: Move = {
    uid: game.players[playerIndex].uid,
    tiles: placedTiles,
    score: total,
    timestamp: Date.now(),
  };

  const isFinished = newBag.length === 0 && newRack.length === 0;

  const { error } = await supabase
    .from('games')
    .update({
      board: newBoard,
      bag: newBag,
      players: updatedPlayers,
      moves: [...game.moves, move],
      status: isFinished ? 'finished' : 'active',
      updated_at: new Date().toISOString(),
      // current_turn intentionally omitted — stays as myUid
    })
    .eq('id', gameId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Solo: Pass Turn ──────────────────────────────────────────────────────────
export async function passSoloTurn(gameId: string, game: Game): Promise<void> {
  const move: Move = { uid: 'pass', tiles: [], score: 0, timestamp: Date.now() };
  const isFinished = trailingPassCount(game.moves) + 1 >= CONSECUTIVE_PASS_LIMIT;
  const { error } = await supabase
    .from('games')
    .update({
      moves: [...game.moves, move],
      status: isFinished ? 'finished' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

// ─── Solo: Swap Tiles ─────────────────────────────────────────────────────────
export async function swapSoloTiles(
  gameId: string,
  game: Game,
  playerIndex: number,
  tileIds: string[]
): Promise<{ success: boolean; error?: string; updatedGame?: Game }> {
  if (tileIds.length === 0) return { success: false, error: 'No tiles selected' };
  if (game.bag.length < tileIds.length) return { success: false, error: 'Not enough tiles in bag to swap' };

  const player = game.players[playerIndex];
  const tilesToReturn = player.rack.filter((t) => tileIds.includes(t.id));
  const remainingRack = player.rack.filter((t) => !tileIds.includes(t.id));

  const newBag = shuffle([...game.bag, ...tilesToReturn]);
  const { drawn, remaining } = drawTiles(newBag, tileIds.length);
  const newRack = [...remainingRack, ...drawn];

  const updatedPlayers = [...game.players] as [Player, Player];
  updatedPlayers[playerIndex] = { ...player, rack: newRack };

  const move: Move = { uid: 'swap', tiles: [], score: 0, timestamp: Date.now() };
  const newMoves = [...game.moves, move];

  const { error } = await supabase
    .from('games')
    .update({
      players: updatedPlayers,
      bag: remaining,
      moves: newMoves,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (error) return { success: false, error: error.message };
  return {
    success: true,
    updatedGame: { ...game, players: updatedPlayers, bag: remaining, moves: newMoves },
  };
}

// ─── Create Game ──────────────────────────────────────────────────────────────
export async function createGame(player1: Player, player2: Player): Promise<string> {
  const bag = createTileBag();
  const { drawn: rack1, remaining: bag2 } = drawTiles(bag, 7);
  const { drawn: rack2, remaining: finalBag } = drawTiles(bag2, 7);

  const payload = {
    player1_uid: player1.uid,
    player2_uid: player2.uid,
    players: [
      { ...player1, rack: rack1, score: 0 },
      { ...player2, rack: rack2, score: 0 },
    ],
    board: createEmptyBoard(),
    bag: finalBag,
    current_turn: player1.uid,
    status: 'active',
    moves: [],
  };

  const { data, error } = await supabase.from('games').insert(payload).select('id').single();
  if (error) throw error;
  return data.id;
}

// ─── Game count (paywall gate) ────────────────────────────────────────────────
// How many games this uid has ever been a part of (solo or multiplayer).
// The native app's paywall gate uses this to detect "already played their
// free game" — derived from existing data, no separate counter column needed.
export async function getUserGameCount(uid: string): Promise<number> {
  const { count, error } = await supabase
    .from('games')
    .select('id', { count: 'exact', head: true })
    .or(`player1_uid.eq.${uid},player2_uid.eq.${uid}`);
  if (error) throw error;
  return count ?? 0;
}

// ─── Rematch ──────────────────────────────────────────────────────────────────
// Fresh game, same players. Loser goes first; on a tie, whoever went second
// last game gets first turn. createGame/createSoloGame re-init rack and score.
export async function createRematch(game: Game): Promise<string> {
  const [p1, p2] = game.players;
  if (p2.email === 'solo') return createSoloGame(p1);
  const first = p1.score < p2.score ? p1 : p2;
  const second = first === p1 ? p2 : p1;
  return createGame(first, second);
}

// Realtime events that fire while the websocket is down (phone locked, app
// backgrounded, bad service) are never replayed — a resumed page would sit on
// stale state until the *next* event. Refetch whenever the app comes back to
// the foreground. Web-only; no-ops on native where window/document don't exist.
function refetchOnResume(refetch: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onResume = () => {
    if (document.visibilityState === 'visible') refetch();
  };
  window.addEventListener('focus', onResume);
  document.addEventListener('visibilitychange', onResume);
  return () => {
    window.removeEventListener('focus', onResume);
    document.removeEventListener('visibilitychange', onResume);
  };
}

// ─── Subscribe to a single game (real-time) ───────────────────────────────────
export function subscribeToGame(gameId: string, onUpdate: (game: Game) => void) {
  // Always fetch the full row — payload.new only contains changed columns, so
  // updates that don't touch 'board' (swap, pass) would give payload.new.board = undefined,
  // crashing BoardComponent when it calls board.map(). A fresh SELECT is always complete.
  const fetchGame = async () => {
    const { data, error } = await supabase.from('games').select('*').eq('id', gameId).single();
    if (error) console.error('Failed to fetch game:', error);
    if (data) onUpdate(rowToGame(data));
  };

  fetchGame();

  const channel = supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      () => fetchGame()
    )
    .subscribe((status: string) => {
      // Rejoining after a dropped socket doesn't replay missed events — catch up.
      if (status === 'SUBSCRIBED') fetchGame();
    });

  const stopResumeRefetch = refetchOnResume(fetchGame);
  return () => {
    stopResumeRefetch();
    supabase.removeChannel(channel);
  };
}

// ─── Subscribe to all games for a user ────────────────────────────────────────
export function subscribeToUserGames(uid: string, onUpdate: (games: Game[]) => void) {
  const fetch = async () => {
    const { data, error } = await supabase
      .from('games')
      .select('*')
      .or(`player1_uid.eq.${uid},player2_uid.eq.${uid}`)
      .order('updated_at', { ascending: false });
    if (error) console.error('Failed to fetch user games:', error);
    if (data) onUpdate(data.map(rowToGame));
  };

  fetch();

  const channel = supabase
    .channel(`user-games-${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, fetch)
    .subscribe((status: string) => {
      if (status === 'SUBSCRIBED') fetch();
    });

  const stopResumeRefetch = refetchOnResume(fetch);
  return () => {
    stopResumeRefetch();
    supabase.removeChannel(channel);
  };
}

// ─── Submit a move ────────────────────────────────────────────────────────────
export async function submitMove(
  gameId: string,
  game: Game,
  playerUid: string,
  placedTiles: PlacedTile[]
): Promise<{ success: boolean; error?: string }> {
  if (game.currentTurn !== playerUid) return { success: false, error: 'Not your turn' };

  const { total } = scoreMove(game.board, placedTiles);
  const newBoard = applyMoveToBoard(game.board, placedTiles);

  const playerIndex = game.players.findIndex((p) => p.uid === playerUid);
  const otherIndex = 1 - playerIndex;

  const usedIds = new Set(placedTiles.map((t) => t.id));
  const remainingRack = game.players[playerIndex].rack.filter((t) => !usedIds.has(t.id));
  const { drawn, remaining: newBag } = drawTiles(game.bag, placedTiles.length);
  const newRack = [...remainingRack, ...drawn];

  const updatedPlayers = [...game.players];
  updatedPlayers[playerIndex] = {
    ...updatedPlayers[playerIndex],
    score: updatedPlayers[playerIndex].score + total,
    rack: newRack,
  };

  const move: Move = {
    uid: playerUid,
    tiles: placedTiles,
    score: total,
    timestamp: Date.now(),
  };

  const isFinished = newBag.length === 0 && newRack.length === 0;

  const { error } = await supabase
    .from('games')
    .update({
      board: newBoard,
      bag: newBag,
      players: updatedPlayers,
      current_turn: game.players[otherIndex].uid,
      moves: [...game.moves, move],
      status: isFinished ? 'finished' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (error) return { success: false, error: error.message };

  // Send push notification to opponent
  const opponent = game.players[otherIndex];
  const myName = game.players[playerIndex].displayName;
  sendPushNotification(opponent.uid, myName, 'turn');

  return { success: true };
}

// ─── Swap tiles ───────────────────────────────────────────────────────────────
export async function swapTiles(
  gameId: string,
  game: Game,
  playerUid: string,
  tileIds: string[]
): Promise<{ success: boolean; error?: string }> {
  if (game.currentTurn !== playerUid) return { success: false, error: 'Not your turn' };
  if (tileIds.length === 0) return { success: false, error: 'No tiles selected' };
  if (game.bag.length < tileIds.length) return { success: false, error: 'Not enough tiles in bag to swap' };

  const playerIndex = game.players.findIndex((p) => p.uid === playerUid);
  const player = game.players[playerIndex];
  const otherIndex = 1 - playerIndex;

  const tilesToReturn = player.rack.filter((t) => tileIds.includes(t.id));
  const remainingRack = player.rack.filter((t) => !tileIds.includes(t.id));

  // Shuffle returned tiles back into bag
  const newBag = shuffle([...game.bag, ...tilesToReturn]);
  const { drawn, remaining } = drawTiles(newBag, tileIds.length);
  const newRack = [...remainingRack, ...drawn];

  const updatedPlayers = [...game.players];
  updatedPlayers[playerIndex] = { ...player, rack: newRack };

  const { error } = await supabase
    .from('games')
    .update({
      players: updatedPlayers,
      bag: remaining,
      current_turn: game.players[otherIndex].uid,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId);

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Pass turn ────────────────────────────────────────────────────────────────
export async function passTurn(gameId: string, game: Game, playerUid: string) {
  if (game.currentTurn !== playerUid) throw new Error('Not your turn');
  const otherIndex = game.players[0].uid === playerUid ? 1 : 0;
  const move: Move = { uid: 'pass', tiles: [], score: 0, timestamp: Date.now() };
  const isFinished = trailingPassCount(game.moves) + 1 >= CONSECUTIVE_PASS_LIMIT;
  const { error } = await supabase
    .from('games')
    .update({
      current_turn: game.players[otherIndex].uid,
      moves: [...game.moves, move],
      status: isFinished ? 'finished' : 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId);
  if (error) throw error;
}

// ─── Love Notes ───────────────────────────────────────────────────────────────
export async function sendLoveNote(
  gameId: string,
  fromUid: string,
  toUid: string,
  message: string,
  emoji: string,
  senderName: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('love_notes').insert({
    game_id: gameId,
    from_uid: fromUid,
    to_uid: toUid,
    message,
    emoji,
    read: false,
  });
  if (error) return { success: false, error: error.message };

  sendPushNotification(toUid, senderName, 'lovenote');
  return { success: true };
}

export function subscribeToLoveNotes(gameId: string, onUpdate: (notes: LoveNote[]) => void) {
  const fetch = async () => {
    const { data } = await supabase
      .from('love_notes')
      .select('*')
      .eq('game_id', gameId)
      .order('created_at', { ascending: false });
    if (data) onUpdate(data.map(rowToNote));
  };

  fetch();

  const channel = supabase
    .channel(`love-notes-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'love_notes', filter: `game_id=eq.${gameId}` },
      fetch
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

export async function markNoteRead(noteId: string) {
  await supabase.from('love_notes').update({ read: true }).eq('id', noteId);
}

// ─── Delete a game ────────────────────────────────────────────────────────────
export async function deleteGame(gameId: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.from('games').delete().eq('id', gameId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rowToGame(row: any): Game {
  return {
    id: row.id,
    players: row.players,
    board: row.board,
    bag: row.bag,
    currentTurn: row.current_turn,
    status: row.status,
    moves: row.moves ?? [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function rowToNote(row: any): LoveNote {
  return {
    id: row.id,
    fromUid: row.from_uid,
    toUid: row.to_uid,
    message: row.message,
    emoji: row.emoji,
    timestamp: new Date(row.created_at).getTime(),
    read: row.read,
  };
}
