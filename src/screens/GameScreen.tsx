import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Game, PlacedTile, Tile } from '../types';
import { subscribeToGame, submitMove, passTurn, swapTiles, submitSoloMove, passSoloTurn, swapSoloTiles } from '../supabase/gameService';
import { getFormedWords } from '../engine/scoring';
import { scoreMove } from '../engine/scoring';
import { validateWords } from '../engine/dictionary';
import { isValidPlacement, BOARD_SIZE } from '../engine/board';
import BoardComponent, { getCellSize } from '../components/BoardComponent';
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
  const prevTurnRef = useRef<string | null>(null);
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelectedIds, setSwapSelectedIds] = useState<string[]>([]);
  const [swapping, setSwapping] = useState(false);
  const [smackTalk, setSmackTalk] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Drag-and-drop
  const [draggingTile, setDraggingTile] = useState<Tile | null>(null);
  const [boardDraggingTileId, setBoardDraggingTileId] = useState<string | null>(null);
  // Tiles that just appeared in the rack (after swap or submit-draw) — briefly highlighted
  // so the player can see what's new.
  const [recentlyDrawnIds, setRecentlyDrawnIds] = useState<Set<string>>(new Set());
  const prevRackIdsRef = useRef<Set<string>>(new Set());
  const prevSideRef = useRef<number>(-1);
  const dragXY = useRef(new Animated.ValueXY()).current;
  const boardRef = useRef<View>(null);
  const boardPos = useRef({ x: 0, y: 0 });
  const prevMovesLengthRef = useRef<number>(-1); // -1 = uninitialized; avoids spurious clear on first load
  const soloWaitingRealtimeRef = useRef(false);  // keeps submitting=true until RT update arrives


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

  const SMACK_TALK = [
    "Yikes… is that really your best? 😬",
    "My grandma scores higher than that 👵",
    "Maybe try actual words next time? 😂",
    "Are you even trying?? 💅",
    "I've seen better plays in a kindergarten class 🍎",
    "That score is giving participation trophy energy 🏅",
    "Babe… I love you but WOW 😂",
    "Should I spot you some vowels? 🙃",
    "Triple word score? You can't even find a double 😏",
    "The bag called — it wants its tiles back 🎲",
    "Even your blank tiles are underperforming 💀",
    "Not to be mean but… actually yes, to be mean 😘",
    "Is your strategy just vibes? Asking for a friend 👀",
    "You spelled 'losing' correctly at least 🤭",
    "Bold strategy, let's see if it pays off… it won't 😂",
    "I still love you even when you play like this 💕… barely",
  ];

  useEffect(() => {
    const unsub = subscribeToGame(gameId, (updatedGame) => {
      // Fire notification if turn just switched to me
      const isSoloUpdated = updatedGame.players.some((p) => p.email === 'solo');

      if (!isSoloUpdated) {
        // Normal game: fire notification when turn switches to me
        const turnJustSwitchedToMe =
          prevTurnRef.current !== null &&
          prevTurnRef.current !== myUid &&
          updatedGame.currentTurn === myUid;

        if (turnJustSwitchedToMe) {
          const opponent = updatedGame.players.find((p) => p.uid !== myUid);
          sendTurnNotification(opponent?.displayName ?? 'Your partner');

          const myPlayer = updatedGame.players.find((p) => p.uid === myUid);
          const them = updatedGame.players.find((p) => p.uid !== myUid);
          if (myPlayer && them && them.score - myPlayer.score > 10) {
            const msg = SMACK_TALK[Math.floor(Math.random() * SMACK_TALK.length)];
            setSmackTalk(msg);
          }
        }
      } else {
        // Solo game: on first update just initialise the ref (no state clear)
        if (prevMovesLengthRef.current === -1) {
          prevMovesLengthRef.current = updatedGame.moves.length;
        } else if (updatedGame.moves.length !== prevMovesLengthRef.current) {
          // A move was committed — reset UI for the next side's turn
          setPendingTiles([]);
          setSelectedTile(null);
          setSwapMode(false);
          setSwapSelectedIds([]);
          setShowPassConfirm(false);
          setSubmitError(null);
          if (soloWaitingRealtimeRef.current) {
            setSubmitting(false);
            setSwapping(false);
            setSwapMode(false);
            setSwapSelectedIds([]);
            soloWaitingRealtimeRef.current = false;
          }
          prevMovesLengthRef.current = updatedGame.moves.length;
        }
      }

      prevTurnRef.current = updatedGame.currentTurn;
      setGame(updatedGame);
    });
    return unsub;
  }, [gameId, myUid]);

  const isSolo = game?.players.some((p) => p.email === 'solo') ?? false;
  // Solo: side alternates by moves count. Multiplayer: find my stable index in the players array.
  const currentSide = isSolo
    ? ((game?.moves.length ?? 0) % 2)
    : (game?.players.findIndex((p) => p.uid === myUid) ?? 0);
  const isMyTurn = isSolo || game?.currentTurn === myUid;
  const me = game?.players[currentSide];
  const partner = game?.players[1 - currentSide];

  // Local-only rack display order (shuffle). Tile ids not in the order (fresh draws)
  // keep their natural position at the end; stale ids are simply ignored.
  const [rackOrder, setRackOrder] = useState<string[] | null>(null);
  const orderedRack = useMemo(() => {
    const rack = me?.rack ?? [];
    if (!rackOrder) return rack;
    const pos = new Map(rackOrder.map((id, i) => [id, i]));
    return [...rack].sort(
      (a, b) => (pos.get(a.id) ?? rackOrder.length) - (pos.get(b.id) ?? rackOrder.length)
    );
  }, [me?.rack, rackOrder]);

  function handleShuffle() {
    const ids = (me?.rack ?? []).map((t) => t.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setRackOrder(ids);
  }

  // Safety net: alert when a pending tile has coords that won't render on the board.
  // These would silently filter the rack and disappear from view ("ghost" tile).
  useEffect(() => {
    const ghosts = pendingTiles.filter(
      (t) =>
        !Number.isFinite(t.row) ||
        !Number.isFinite(t.col) ||
        t.row < 0 ||
        t.row >= BOARD_SIZE ||
        t.col < 0 ||
        t.col >= BOARD_SIZE
    );
    if (ghosts.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[lovewords] ghost pending tiles detected', ghosts);
    }
  }, [pendingTiles]);

  // Flash a highlight on tiles that just appeared in the rack (after swap or post-submit draw).
  // In solo mode, currentSide flips between moves and "me" becomes the other player —
  // that whole rack is "new" but isn't actually a draw, so skip the highlight on side flip.
  useEffect(() => {
    if (!me) return;
    const newIds = new Set(me.rack.map((t) => t.id));
    const sideChanged = prevSideRef.current !== currentSide;
    prevSideRef.current = currentSide;
    if (sideChanged || prevRackIdsRef.current.size === 0) {
      prevRackIdsRef.current = newIds;
      return;
    }
    const added = [...newIds].filter((id) => !prevRackIdsRef.current.has(id));
    prevRackIdsRef.current = newIds;
    if (added.length === 0) return;
    setRecentlyDrawnIds(new Set(added));
    const t = setTimeout(() => setRecentlyDrawnIds(new Set()), 2200);
    return () => clearTimeout(t);
  }, [me?.rack, currentSide]);
  // activeUid for non-solo submit calls only
  const activeUid = game?.currentTurn ?? myUid;
  const isFirstMove = game?.moves.length === 0;

  // Live score preview — recalculates whenever tiles are placed
  const previewScore = useMemo(() => {
    if (!game || pendingTiles.length === 0) return null;
    try {
      const { total } = scoreMove(game.board, pendingTiles);
      return total;
    } catch {
      return null;
    }
  }, [game, pendingTiles]);

  // Highlight the tiles from the most recent committed word move
  const lastMoveTiles = useMemo(() => {
    if (!game) return new Set<string>();
    const lastWordMove = game.moves.slice().reverse().find((m) => m.tiles.length > 0);
    return new Set(lastWordMove?.tiles.map((t) => `${t.row},${t.col}`) ?? []);
  }, [game?.moves]);

  // Rack tap selects/deselects a tile (click-to-place for web; drag still works on mobile)
  function handleRackTilePress(tile: Tile) {
    if (!isMyTurn || game?.status !== 'active') return;
    setSelectedTile((prev) => prev?.id === tile.id ? null : tile);
  }

  // Place a tile on the board
  function handleCellPress(row: number, col: number) {
    if (!selectedTile || !game || !isMyTurn) return;
    if (game.board[row][col].tile !== null) return; // already has a committed tile
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
    setSubmitError(null);
  }

  // ── Drag handlers ─────────────────────────────────────────────────────────
  function handleDragStart(tile: Tile, pageX: number, pageY: number) {
    if (!isMyTurn || game?.status !== 'active') return;
    // Measure board position fresh each drag
    boardRef.current?.measure((_x, _y, _w, _h, bpx, bpy) => {
      boardPos.current = { x: bpx, y: bpy };
    });
    setDraggingTile(tile);
    setSelectedTile(null);
    dragXY.setValue({ x: pageX - 25, y: pageY - 25 });
  }

  function handleDragMove(pageX: number, pageY: number) {
    dragXY.setValue({ x: pageX - 25, y: pageY - 25 });
  }

  function handleDragEnd(pageX: number, pageY: number, tile: Tile) {
    setDraggingTile(null);
    setBoardDraggingTileId(null);
    if (!game || !isMyTurn) return;
    const cellSize = getCellSize();
    const col = Math.floor((pageX - boardPos.current.x - 2) / cellSize);
    const row = Math.floor((pageY - boardPos.current.y - 2) / cellSize);
    // Remove from old position (no-op if this was a rack drag)
    const removeOld = (prev: PlacedTile[]) => prev.filter((t) => t.id !== tile.id);
    // Treat non-finite (NaN/Infinity) coords as off-board too — otherwise the row/col
    // range check passes (NaN comparisons are false) and we'd add a tile with bad coords
    // to pendingTiles, where it filters the rack but never renders on the board.
    const validCoords = Number.isFinite(row) && Number.isFinite(col);
    if (!validCoords || row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
      if (!validCoords) {
        // eslint-disable-next-line no-console
        console.warn('[lovewords] drag drop with bad coords', { pageX, pageY, boardPos: boardPos.current, cellSize, tile });
      }
      // Dropped off-board — return to rack by removing from pendingTiles
      setPendingTiles(removeOld);
      return;
    }
    if (game.board[row][col].tile !== null) {
      // Occupied committed cell — put back at original position
      setBoardDraggingTileId(null);
      return;
    }
    if (tile.isBlank) {
      setPendingTiles(removeOld);
      setSelectedTile(tile);
      setBlankPicker({ row, col });
    } else {
      setPendingTiles((prev) => {
        const filtered = removeOld(prev);
        if (filtered.find((t) => t.row === row && t.col === col)) return prev; // occupied pending cell — abort
        return [...filtered, { ...tile, row, col, isNew: true }];
      });
    }
  }

  function handleDragCancel() {
    setDraggingTile(null);
    setBoardDraggingTileId(null);
  }

  // Drag a tile that's already placed on the board to a new cell.
  // Removes it from pendingTiles immediately so the cell clears, then starts the
  // floating animation — handleDragEnd lands it on the new target cell as normal.
  function handleBoardTileDragStart(tile: Tile, pageX: number, pageY: number) {
    if (!isMyTurn || game?.status !== 'active') return;
    boardRef.current?.measure((_x, _y, _w, _h, bpx, bpy) => {
      boardPos.current = { x: bpx, y: bpy };
    });
    // Keep tile in pendingTiles so the DraggablePendingTile component stays mounted
    // and its PanResponder stays alive. Hide it visually via boardDraggingTileId.
    setBoardDraggingTileId(tile.id);
    setDraggingTile(tile);
    setSelectedTile(null);
    dragXY.setValue({ x: pageX - 25, y: pageY - 25 });
  }


  // Submit the move
  async function handleSubmit() {
    if (!game || !isMyTurn || pendingTiles.length === 0) return;
    setSubmitError(null);
    setSubmitSuccess(null);

    // Validate placement
    if (!isValidPlacement(game.board, pendingTiles, isFirstMove ?? false)) {
      setSubmitError('Tiles must form a line and connect to existing tiles (first move must cover the center ★).');
      return;
    }

    const words = getFormedWords(game.board, pendingTiles);
    if (words.length === 0) {
      setSubmitError('No words formed — try a different placement.');
      return;
    }

    setValidating(true);
    let valid = true;
    let invalidWords: string[] = [];
    try {
      const result = await validateWords(words);
      valid = result.valid;
      invalidWords = result.invalidWords;
    } catch {
      // dictionary error — be generous and allow the word
    } finally {
      setValidating(false);
    }

    if (!valid) {
      setSubmitError(`"${invalidWords.join('", "')}" ${invalidWords.length > 1 ? 'are' : 'is'} not in the dictionary.`);
      return;
    }

    const { total } = scoreMove(game.board, pendingTiles);

    setSubmitting(true);
    // Solo: arm the realtime-clear BEFORE awaiting. The realtime fetch can resolve
    // before the update's own await does (the channel fires inside the update);
    // if the ref isn't set yet, the callback skips its clear and the spinner sticks.
    let holdForRealtime = isSolo;
    if (isSolo) soloWaitingRealtimeRef.current = true;
    try {
      const result = isSolo
        ? await submitSoloMove(gameId, game, currentSide, pendingTiles)
        : await submitMove(gameId, game, activeUid, pendingTiles);
      if (!result.success) {
        setSubmitError(result.error ?? 'Something went wrong — try again.');
        if (isSolo) {
          soloWaitingRealtimeRef.current = false;
          holdForRealtime = false;
        }
      } else {
        if (!isSolo) setPendingTiles([]);
        setSubmitSuccess(`✅ ${words.join(', ')} — +${total} pts`);
        setTimeout(() => setSubmitSuccess(null), 3000);
      }
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Network error — try again.');
      if (isSolo) {
        soloWaitingRealtimeRef.current = false;
        holdForRealtime = false;
      }
    } finally {
      if (!holdForRealtime) setSubmitting(false);
    }
  }

  async function handlePass() {
    if (!game) return;
    if (isSolo) {
      await passSoloTurn(gameId, game);
    } else {
      await passTurn(gameId, game, activeUid);
    }
    setPendingTiles([]);
    setShowPassConfirm(false);
  }

  function handleEnterSwapMode() {
    setPendingTiles([]);
    setSelectedTile(null);
    setSwapSelectedIds([]);
    setSwapMode(true);
  }

  // Tap a tile in swap mode → toggle it in the selection list (no DB call yet).
  function handleSwapTileSelect(tileId: string) {
    if (!game || swapping) return;
    setSwapSelectedIds((prev) =>
      prev.includes(tileId) ? prev.filter((id) => id !== tileId) : [...prev, tileId]
    );
  }

  // Confirm button — commits all selected tiles to a single swap operation.
  async function handleConfirmSwap() {
    if (!game || swapping || swapSelectedIds.length === 0) return;
    if (game.bag.length < swapSelectedIds.length) {
      setSubmitError(
        `Only ${game.bag.length} tile${game.bag.length === 1 ? '' : 's'} left in the bag — can't swap ${swapSelectedIds.length}.`
      );
      return;
    }
    setSwapping(true);
    setSubmitError(null);
    try {
      const result = isSolo
        ? await swapSoloTiles(gameId, game, currentSide, swapSelectedIds)
        : await swapTiles(gameId, game, activeUid, swapSelectedIds);
      if (!result.success) {
        setSubmitError(result.error ?? 'Could not swap — try again.');
      } else {
        const updated = (result as { updatedGame?: Game }).updatedGame;
        if (updated) setGame(updated);
      }
    } catch (e: any) {
      setSubmitError(e?.message ?? 'Swap failed — try again.');
    } finally {
      setSwapping(false);
      setSwapMode(false);
      setSwapSelectedIds([]);
    }
  }

  if (!game) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  if (game.status === 'finished') {
    const isSoloFinished = game.players.some((p) => p.email === 'solo');
    const winner =
      game.players[0].score > game.players[1].score
        ? game.players[0]
        : game.players[0].score < game.players[1].score
        ? game.players[1]
        : null;
    return (
      <View style={styles.loading}>
        <Text style={styles.finishedEmoji}>
          {isSoloFinished ? '🎯' : winner?.uid === myUid ? '🏆' : '💕'}
        </Text>
        <Text style={styles.finishedText}>
          {isSoloFinished
            ? 'Practice complete!'
            : winner
            ? winner.uid === myUid
              ? 'You won!'
              : `${winner.displayName} won!`
            : "It's a tie! 💕"}
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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back to games" accessibilityRole="button">
          <Text style={styles.back}>← Games</Text>
        </TouchableOpacity>
        {!isSolo && (
          <TouchableOpacity onPress={() => setShowLoveNotes(true)} style={styles.loveBtn} accessibilityLabel="Open love notes" accessibilityRole="button">
            <Text style={styles.loveBtnText}>💌 Note</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Scoreboard */}
      <ScoreBoard
        players={game.players}
        currentTurn={game.currentTurn}
        myUid={myUid}
        bagCount={game.bag.length}
        isSolo={isSolo}
        currentSide={currentSide}
      />

      {/* Turn indicator */}
      <View style={[styles.turnBanner, isMyTurn ? styles.turnBannerMine : styles.turnBannerTheirs]}>
        <Text style={styles.turnText}>
          {isSolo
            ? `🎯 Playing as ${me?.displayName ?? 'Player'}`
            : isMyTurn
            ? '💌 Your turn — place your tiles!'
            : `⏳ Waiting for ${partner?.displayName}…`}
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
        boardRef={boardRef}
        lastMoveTiles={lastMoveTiles}
        boardDraggingTileId={boardDraggingTileId}
        boardTileDragCallbacks={isMyTurn && game.status === 'active' ? {
          onDragStart: handleBoardTileDragStart,
          onDragMove: handleDragMove,
          onDragEnd: handleDragEnd,
          onDragCancel: handleDragCancel,
        } : undefined}
      />

      </ScrollView>

      {/* Rack + action row pinned outside ScrollView so Submit is always reachable */}
      <View style={styles.bottomBar}>

      {/* Tile rack — behaviour switches based on swapMode; only one rack ever renders */}
      <TileRack
        tiles={orderedRack.filter((t) => !pendingTiles.find((p) => p.id === t.id))}
        onShuffle={handleShuffle}
        selectedTileId={swapMode ? null : selectedTile?.id ?? null}
        onTilePress={swapMode ? (t) => handleSwapTileSelect(t.id) : handleRackTilePress}
        disabled={!isMyTurn || game.status !== 'active'}
        swapSelectedIds={swapSelectedIds}
        recentlyDrawnIds={recentlyDrawnIds}
        draggingTileId={swapMode ? null : draggingTile?.id ?? null}
        dragCallbacks={swapMode ? undefined : {
          onDragStart: handleDragStart,
          onDragMove: handleDragMove,
          onDragEnd: handleDragEnd,
          onDragCancel: handleDragCancel,
        }}
      />

      {/* Action buttons */}
      {isMyTurn && (
        <View>
          {/* Inline submit feedback */}
          {submitError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>⚠️ {submitError}</Text>
              <TouchableOpacity onPress={() => setSubmitError(null)} accessibilityLabel="Dismiss error" accessibilityRole="button">
                <Text style={styles.errorBannerDismiss}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {submitSuccess && (
            <View style={styles.successBanner}>
              <Text style={styles.successBannerText}>{submitSuccess}</Text>
            </View>
          )}

          {/* Selection hint */}
          {!swapMode && (
            <Text style={styles.hint}>
              {pendingTiles.length > 0
                ? 'Tap a placed tile to return it, or drag to reposition'
                : 'Tap or drag tiles onto the board'}
            </Text>
          )}

          {/* Swap mode */}
          {swapMode ? (
            <View>
              <Text style={styles.hint}>
                {swapping
                  ? 'Drawing your new tiles…'
                  : swapSelectedIds.length === 0
                  ? 'Tap tiles to mark them for swap, then Confirm'
                  : `${swapSelectedIds.length} tile${swapSelectedIds.length === 1 ? '' : 's'} selected — tap again to deselect`}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.actionBtnSecondary, swapping && styles.actionBtnDisabled]}
                  onPress={() => {
                    setSwapMode(false);
                    setSwapSelectedIds([]);
                  }}
                  disabled={swapping}
                >
                  <Text style={styles.actionBtnSecondaryText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    (swapSelectedIds.length === 0 || swapping) && styles.actionBtnDisabled,
                  ]}
                  onPress={handleConfirmSwap}
                  disabled={swapSelectedIds.length === 0 || swapping}
                >
                  {swapping ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.actionBtnText}>
                      Confirm{swapSelectedIds.length > 0 ? ` (${swapSelectedIds.length})` : ''}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : showPassConfirm ? (
            <View style={styles.actions}>
              <Text style={[styles.hint, { flex: 1, textAlign: 'center' }]}>Pass your turn?</Text>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={() => setShowPassConfirm(false)}>
                <Text style={styles.actionBtnSecondaryText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={handlePass}>
                <Text style={styles.actionBtnText}>Yes, Pass</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleRecall} disabled={pendingTiles.length === 0}>
                <Text style={styles.actionBtnSecondaryText}>Recall</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={handleEnterSwapMode}>
                <Text style={styles.actionBtnSecondaryText}>Swap</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtnSecondary} onPress={() => setShowPassConfirm(true)}>
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
                    {!dictReady
                      ? 'Loading…'
                      : previewScore !== null
                      ? `Submit  +${previewScore} pts`
                      : 'Submit'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      </View>

      {/* Floating tile during drag — outside ScrollView so it stays fixed on screen */}
      {draggingTile && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFillObject, { zIndex: 999 }]}
        >
          <Animated.View style={[styles.floatingTile, { transform: dragXY.getTranslateTransform() }]}>
            <Text style={styles.floatingLetter}>{draggingTile.isBlank ? '★' : draggingTile.letter}</Text>
            {!draggingTile.isBlank && <Text style={styles.floatingValue}>{draggingTile.value}</Text>}
          </Animated.View>
        </Animated.View>
      )}

      {/* Love notes modal — hidden in solo mode */}
      {!isSolo && (
        <LoveNotesModal
          visible={showLoveNotes}
          onClose={() => setShowLoveNotes(false)}
          gameId={gameId}
          myUid={myUid}
          myDisplayName={myDisplayName}
          partnerUid={partner?.uid ?? ''}
        />
      )}

      {/* Smack talk popup */}
      <Modal visible={!!smackTalk} transparent animationType="fade">
        <TouchableOpacity
          style={styles.smackOverlay}
          activeOpacity={1}
          onPress={() => setSmackTalk(null)}
        >
          <View style={styles.smackModal}>
            <Text style={styles.smackEmoji}>😂</Text>
            <Text style={styles.smackText}>{smackTalk}</Text>
            <TouchableOpacity style={styles.smackBtn} onPress={() => setSmackTalk(null)}>
              <Text style={styles.smackBtnText}>Okay okay 😤</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 8 },
  bottomBar: {
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  back: { color: Colors.primaryDark, fontSize: 16, fontWeight: '600' },
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
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: Colors.textLight,
    paddingVertical: 4,
    fontStyle: 'italic',
  },
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
  floatingTile: {
    position: 'absolute',
    width: 50,
    height: 50,
    backgroundColor: Colors.tileSelected,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 12,
  },
  floatingLetter: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.tileText,
  },
  floatingValue: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textLight,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: 8,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: '#C0392B',
    fontWeight: '600',
    lineHeight: 16,
  },
  errorBannerDismiss: {
    fontSize: 14,
    color: '#C0392B',
    fontWeight: '700',
    paddingLeft: 8,
  },
  successBanner: {
    backgroundColor: '#F0FFF4',
    borderRadius: 8,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#A8E6B0',
    alignItems: 'center',
  },
  successBannerText: {
    fontSize: 13,
    color: '#1E7B34',
    fontWeight: '700',
  },
  smackOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  smackModal: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 28,
    width: '80%',
    maxWidth: 340,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 12,
  },
  smackEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  smackText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 20,
  },
  smackBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  smackBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
