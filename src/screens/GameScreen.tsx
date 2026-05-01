import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  Modal,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Game, PlacedTile, Tile } from '../types';
import { subscribeToGame, submitMove, passTurn } from '../supabase/gameService';
import { getFormedWords } from '../engine/scoring';
import { scoreMove } from '../engine/scoring';
import { validateWords } from '../engine/dictionary';
import { isValidPlacement } from '../engine/board';
import BoardComponent from '../components/BoardComponent';
import TileRack from '../components/TileRack';
import ScoreBoard from '../components/ScoreBoard';
import LoveNotesModal from './LoveNotesModal';
import { Colors } from '../utils/colors';
import { requestNotificationPermission, sendTurnNotification } from '../utils/webNotifications';
import { isDictionaryLoaded } from '../engine/dictionary';

type RouteParams = { gameId: string; myUid: string; myDisplayName: string };

export default function GameScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const { gameId, myUid, myDisplayName } = route.params as RouteParams;

  const [game, setGame] = useState<Game | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [pendingTiles, setPendingTiles] = useState<PlacedTile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showLoveNotes, setShowLoveNotes] = useState(false);
  const [validating, setValidating] = useState(false);
  const [blankPicker, setBlankPicker] = useState<{ row: number; col: number } | null>(null);
  const [dictReady, setDictReady] = useState(isDictionaryLoaded());
  const prevTurnRef = React.useRef<string | null>(null);

  // Poll until dictionary finishes loading
  useEffect(() => {
    if (dictReady) return;
    const interval = setInterval(() => {
      if (isDictionaryLoaded()) {
        setDictReady(true);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [dictReady]);

  // Request notification permission on load
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    const unsub = subscribeToGame(gameId, (updatedGame) => {
      // Fire notification if turn just switched to me
      if (
        prevTurnRef.current !== null &&
        prevTurnRef.current !== myUid &&
        updatedGame.currentTurn === myUid
      ) {
        const opponent = updatedGame.players.find((p) => p.uid !== myUid);
        sendTurnNotification(opponent?.displayName ?? 'Your partner');
      }
      prevTurnRef.current = updatedGame.currentTurn;
      setGame(updatedGame);
    });
    return unsub;
  }, [gameId, myUid]);

  const isMyTurn = game?.currentTurn === myUid;
  const me = game?.players.find((p) => p.uid === myUid);
  const partner = game?.players.find((p) => p.uid !== myUid);
  const isFirstMove = game?.moves.length === 0;

  // Handle rack tile selection
  function handleRackTilePress(tile: Tile) {
    if (!isMyTurn || game?.status !== 'active') return;
    setSelectedTile((prev) => (prev?.id === tile.id ? null : tile));
  }

  // Place a tile on the board
  function handleCellPress(row: number, col: number) {
    if (!selectedTile || !game || !isMyTurn) return;
    if (pendingTiles.find((t) => t.row === row && t.col === col)) return;

    if (selectedTile.isBlank) {
      // Show letter picker for blank tile
      setBlankPicker({ row, col });
    } else {
      const placed: PlacedTile = { ...selectedTile, row, col, isNew: true };
      setPendingTiles((prev) => [...prev, placed]);
      setSelectedTile(null);
    }
  }

  // Called when user picks a letter for their blank tile
  function handleBlankLetterPick(letter: string) {
    if (!blankPicker || !selectedTile) return;
    const placed: PlacedTile = {
      ...selectedTile,
      letter,
      value: 0, // blank tiles are always worth 0 pts
      row: blankPicker.row,
      col: blankPicker.col,
      isNew: true,
    };
    setPendingTiles((prev) => [...prev, placed]);
    setSelectedTile(null);
    setBlankPicker(null);
  }

  // Remove a pending tile (tap it to return to rack)
  function handlePendingTilePress(tile: PlacedTile) {
    setPendingTiles((prev) => prev.filter((t) => t.id !== tile.id));
  }

  // Clear all pending tiles
  function handleRecall() {
    setPendingTiles([]);
    setSelectedTile(null);
  }

  // Submit the move
  async function handleSubmit() {
    if (!game || !isMyTurn || pendingTiles.length === 0) return;

    // Validate placement
    if (!isValidPlacement(game.board, pendingTiles, isFirstMove ?? false)) {
      Alert.alert('Invalid placement', 'Tiles must connect to existing tiles and form a line.');
      return;
    }

    const words = getFormedWords(game.board, pendingTiles);
    if (words.length === 0) {
      Alert.alert('No words formed', 'Try a different placement.');
      return;
    }

    setValidating(true);
    const { valid, invalidWords } = await validateWords(words);
    setValidating(false);

    if (!valid) {
      Alert.alert(
        'Invalid word(s)',
        `"${invalidWords.join('", "')}" ${invalidWords.length > 1 ? 'are' : 'is'} not in the dictionary.`
      );
      return;
    }

    const { total } = scoreMove(game.board, pendingTiles);

    setSubmitting(true);
    const result = await submitMove(gameId, game, myUid, pendingTiles);
    setSubmitting(false);
    if (!result.success) {
      Alert.alert('Error', result.error ?? 'Something went wrong');
    } else {
      setPendingTiles([]);
      Alert.alert('✅ Nice!', `${words.join(', ')} — +${total} pts`);
    }
  }

  async function handlePass() {
    if (!game) return;
    Alert.alert('Pass turn?', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pass',
        onPress: async () => {
          await passTurn(gameId, game, myUid);
          setPendingTiles([]);
        },
      },
    ]);
  }

  if (!game) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (game.status === 'finished') {
    const winner =
      game.players[0].score > game.players[1].score
        ? game.players[0]
        : game.players[0].score < game.players[1].score
        ? game.players[1]
        : null;
    return (
      <View style={styles.loading}>
        <Text style={styles.finishedEmoji}>{winner?.uid === myUid ? '🏆' : '💕'}</Text>
        <Text style={styles.finishedText}>
          {winner ? (winner.uid === myUid ? 'You won!' : `${winner.displayName} won!`) : "It's a tie! 💕"}
        </Text>
        <Text style={styles.finishedScores}>
          {game.players[0].displayName} {game.players[0].score} – {game.players[1].score} {game.players[1].displayName}
        </Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Back to games</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Games</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowLoveNotes(true)} style={styles.loveBtn}>
          <Text style={styles.loveBtnText}>💌 Note</Text>
        </TouchableOpacity>
      </View>

      {/* Scoreboard */}
      <ScoreBoard
        players={game.players}
        currentTurn={game.currentTurn}
        myUid={myUid}
        bagCount={game.bag.length}
      />

      {/* Turn indicator */}
      <View style={[styles.turnBanner, isMyTurn ? styles.turnBannerMine : styles.turnBannerTheirs]}>
        <Text style={styles.turnText}>
          {isMyTurn ? '💌 Your turn — place your tiles!' : `⏳ Waiting for ${partner?.displayName}…`}
        </Text>
      </View>

      {/* Board */}
      <BoardComponent
        board={game.board}
        pendingTiles={pendingTiles}
        selectedTile={selectedTile}
        onCellPress={handleCellPress}
        onTilePress={handlePendingTilePress}
        isMyTurn={isMyTurn}
      />

      {/* Tile rack */}
      <TileRack
        tiles={me?.rack.filter((t) => !pendingTiles.find((p) => p.id === t.id)) ?? []}
        selectedTileId={selectedTile?.id ?? null}
        onTilePress={handleRackTilePress}
        disabled={!isMyTurn || game.status !== 'active'}
      />

      {/* Action buttons */}
      {isMyTurn && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleRecall} disabled={pendingTiles.length === 0}>
            <Text style={styles.actionBtnSecondaryText}>Recall</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtnSecondary} onPress={handlePass}>
            <Text style={styles.actionBtnSecondaryText}>Pass</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, (pendingTiles.length === 0 || submitting || validating || !dictReady) && styles.actionBtnDisabled]}
            onPress={handleSubmit}
            disabled={pendingTiles.length === 0 || submitting || validating}
          >
            {submitting || validating ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.actionBtnText}>
                {!dictReady ? 'Loading dictionary…' : `Submit ${pendingTiles.length > 0 ? `(${pendingTiles.length})` : ''}`}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Love notes modal */}
      <LoveNotesModal
        visible={showLoveNotes}
        onClose={() => setShowLoveNotes(false)}
        gameId={gameId}
        myUid={myUid}
        partnerUid={partner?.uid ?? ''}
      />

      {/* Blank tile letter picker */}
      <Modal visible={!!blankPicker} transparent animationType="fade">
        <View style={styles.blankOverlay}>
          <View style={styles.blankModal}>
            <Text style={styles.blankTitle}>Pick a letter for your blank tile ★</Text>
            <View style={styles.blankGrid}>
              {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => (
                <TouchableOpacity
                  key={letter}
                  style={styles.blankLetterBtn}
                  onPress={() => handleBlankLetterPick(letter)}
                >
                  <Text style={styles.blankLetterText}>{letter}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={() => setBlankPicker(null)} style={styles.blankCancel}>
              <Text style={styles.blankCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: { color: Colors.primary, fontSize: 16, fontWeight: '600' },
  loveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  loveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  turnBanner: {
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  turnBannerMine: { backgroundColor: '#FFF0F5' },
  turnBannerTheirs: { backgroundColor: '#F5F5F5' },
  turnText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  actionBtn: {
    flex: 2,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  actionBtnDisabled: { backgroundColor: Colors.border },
  actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionBtnSecondaryText: { color: Colors.text, fontWeight: '600', fontSize: 14 },
  finishedEmoji: { fontSize: 64, marginBottom: 12 },
  finishedText: { fontSize: 28, fontWeight: '900', color: Colors.primary, marginBottom: 8 },
  finishedScores: { fontSize: 16, color: Colors.textLight, marginBottom: 32 },
  backBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  backBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  blankOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blankModal: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  blankTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  blankGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  blankLetterBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blankLetterText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  blankCancel: {
    marginTop: 16,
    alignItems: 'center',
  },
  blankCancelText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
});
