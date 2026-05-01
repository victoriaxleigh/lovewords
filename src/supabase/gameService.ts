import { supabase } from './config';
import { Game, Player, PlacedTile, LoveNote, Move } from '../types';
import { createEmptyBoard, applyMoveToBoard } from '../engine/board';
import { createTileBag, drawTiles } from '../engine/tiles';
import { scoreMove } from '../engine/scoring';

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

// ─── Subscribe to a single game (real-time) ───────────────────────────────────
export function subscribeToGame(gameId: string, onUpdate: (game: Game) => void) {
  // Fetch initial state
  supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single()
    .then(({ data, error }) => {
      if (error) console.error('Failed to fetch game:', error);
      if (data) onUpdate(rowToGame(data));
    })
    .catch((err) => console.error('Game fetch error:', err));

  // Subscribe to changes
  const channel = supabase
    .channel(`game-${gameId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => onUpdate(rowToGame(payload.new))
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
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
    .subscribe();

  return () => supabase.removeChannel(channel);
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
  return { success: true };
}

// ─── Pass turn ────────────────────────────────────────────────────────────────
export async function passTurn(gameId: string, game: Game, playerUid: string) {
  const otherIndex = game.players[0].uid === playerUid ? 1 : 0;
  const { error } = await supabase
    .from('games')
    .update({
      current_turn: game.players[otherIndex].uid,
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
  emoji: string
) {
  await supabase.from('love_notes').insert({
    game_id: gameId,
    from_uid: fromUid,
    to_uid: toUid,
    message,
    emoji,
    read: false,
  });
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
