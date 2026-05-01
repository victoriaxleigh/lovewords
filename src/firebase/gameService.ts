import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  addDoc,
  serverTimestamp,
  arrayUnion,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import { Game, Player, PlacedTile, LoveNote, Move } from '../types';
import { createEmptyBoard, applyMoveToBoard } from '../engine/board';
import { createTileBag, drawTiles } from '../engine/tiles';
import { scoreMove } from '../engine/scoring';

const GAMES = 'games';
const LOVE_NOTES = 'loveNotes';

// Create a new game between two players
export async function createGame(player1: Player, player2: Player): Promise<string> {
  const bag = createTileBag();
  const { drawn: rack1, remaining: bag2 } = drawTiles(bag, 7);
  const { drawn: rack2, remaining: finalBag } = drawTiles(bag2, 7);

  const game: Omit<Game, 'id'> & { playerUids: string[] } = {
    players: [
      { ...player1, rack: rack1, score: 0 },
      { ...player2, rack: rack2, score: 0 },
    ],
    playerUids: [player1.uid, player2.uid], // needed for Firestore array-contains queries
    board: createEmptyBoard(),
    bag: finalBag,
    currentTurn: player1.uid,
    status: 'active',
    moves: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const ref = await addDoc(collection(db, GAMES), game);
  return ref.id;
}

// Subscribe to live game updates
export function subscribeToGame(gameId: string, onUpdate: (game: Game) => void): Unsubscribe {
  const ref = doc(db, GAMES, gameId);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      onUpdate({ id: snap.id, ...snap.data() } as Game);
    }
  });
}

// Get all games for a user
export function subscribeToUserGames(uid: string, onUpdate: (games: Game[]) => void): Unsubscribe {
  const q = query(
    collection(db, GAMES),
    where('players', 'array-contains-any', [uid]),
    orderBy('updatedAt', 'desc')
  );
  // Note: Firestore can't query nested fields directly; we query by uid stored in playerUids
  const q2 = query(
    collection(db, GAMES),
    where('playerUids', 'array-contains', uid),
    orderBy('updatedAt', 'desc')
  );
  return onSnapshot(q2, (snap) => {
    const games = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Game));
    onUpdate(games);
  });
}

// Submit a move
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

  // Refill rack
  const usedTileIds = new Set(placedTiles.map((t) => t.id));
  const remainingRack = game.players[playerIndex].rack.filter((t) => !usedTileIds.has(t.id));
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

  const ref = doc(db, GAMES, gameId);
  await updateDoc(ref, {
    board: newBoard,
    bag: newBag,
    players: updatedPlayers,
    currentTurn: game.players[otherIndex].uid,
    moves: arrayUnion(move),
    updatedAt: Date.now(),
    status: newBag.length === 0 && newRack.length === 0 ? 'finished' : 'active',
  });

  return { success: true };
}

// Pass turn
export async function passTurn(gameId: string, game: Game, playerUid: string): Promise<void> {
  const otherIndex = game.players[0].uid === playerUid ? 1 : 0;
  await updateDoc(doc(db, GAMES, gameId), {
    currentTurn: game.players[otherIndex].uid,
    updatedAt: Date.now(),
  });
}

// Send a love note 💌
export async function sendLoveNote(
  gameId: string,
  fromUid: string,
  toUid: string,
  message: string,
  emoji: string
): Promise<void> {
  const note: Omit<LoveNote, 'id'> = {
    fromUid,
    toUid,
    message,
    emoji,
    timestamp: Date.now(),
    read: false,
  };
  await addDoc(collection(db, GAMES, gameId, LOVE_NOTES), note);
}

// Subscribe to love notes in a game
export function subscribeToLoveNotes(
  gameId: string,
  onUpdate: (notes: LoveNote[]) => void
): Unsubscribe {
  const q = query(
    collection(db, GAMES, gameId, LOVE_NOTES),
    orderBy('timestamp', 'desc')
  );
  return onSnapshot(q, (snap) => {
    const notes = snap.docs.map((d) => ({ id: d.id, ...d.data() } as LoveNote));
    onUpdate(notes);
  });
}

// Mark love note as read
export async function markNoteRead(gameId: string, noteId: string): Promise<void> {
  await updateDoc(doc(db, GAMES, gameId, LOVE_NOTES, noteId), { read: true });
}
