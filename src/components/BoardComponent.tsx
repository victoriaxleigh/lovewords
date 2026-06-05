import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { Board, PlacedTile, Tile } from '../types';
import { BOARD_SIZE } from '../engine/board';
import { Colors } from '../utils/colors';
import TileComponent from './TileComponent';

const DRAG_THRESHOLD = 5;

// Phone gets ~25px cells (board fills the width). Desktop is capped so the board
// doesn't sprawl across a 1400px window. Also constrained by vertical space so the
// pinned bottom bar (rack + action row) doesn't overlap it.
const MAX_CELL_SIZE = 36;
const CHROME_HEIGHT = 320; // header + scoreboard + turn banner + rack + actions + padding

function computeCellSize(windowWidth: number, windowHeight: number): number {
  const widthBased = Math.floor((windowWidth - 8) / BOARD_SIZE);
  const heightBased = Math.floor((windowHeight - CHROME_HEIGHT) / BOARD_SIZE);
  return Math.max(20, Math.min(MAX_CELL_SIZE, widthBased, heightBased));
}

// Live cell size at call time — GameScreen uses this for drag-end coordinate math
// so resizes are picked up correctly.
export function getCellSize(): number {
  if (typeof window === 'undefined') return MAX_CELL_SIZE;
  return computeCellSize(window.innerWidth, window.innerHeight);
}

export type BoardTileDragCallbacks = {
  onDragStart: (tile: Tile, pageX: number, pageY: number) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number, tile: Tile) => void;
  onDragCancel: () => void;
};

type Props = {
  board: Board;
  pendingTiles: PlacedTile[];
  selectedTile: Tile | null;
  onCellPress: (row: number, col: number) => void;
  onTilePress?: (tile: PlacedTile) => void;
  isMyTurn: boolean;
  boardRef?: React.RefObject<View>;
  boardTileDragCallbacks?: BoardTileDragCallbacks;
  lastMoveTiles?: Set<string>;
  boardDraggingTileId?: string | null;
};

function DraggablePendingTile({
  tile, size, onTilePress, dragCallbacks, isDragging,
}: {
  tile: PlacedTile;
  size: number;
  onTilePress: () => void;
  dragCallbacks?: BoardTileDragCallbacks;
  isDragging?: boolean;
}) {
  const wrapRef = useRef<View>(null);
  const tileRef = useRef(tile);
  const onTilePressRef = useRef(onTilePress);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  useEffect(() => {
    const el = wrapRef.current as unknown as HTMLElement | null;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let dragStarted = false;
    let activePointerId: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (activePointerId !== null) return;
      activePointerId = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      startX = e.clientX;
      startY = e.clientY;
      dragStarted = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragStarted && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragStarted = true;
        dragCallbacksRef.current?.onDragStart(tileRef.current, e.clientX, e.clientY);
      }
      if (dragStarted) {
        e.preventDefault();
        dragCallbacksRef.current?.onDragMove(e.clientX, e.clientY);
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (dragStarted) {
        dragCallbacksRef.current?.onDragEnd(e.clientX, e.clientY, tileRef.current);
      } else {
        onTilePressRef.current();
      }
      activePointerId = null;
      dragStarted = false;
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (dragStarted) dragCallbacksRef.current?.onDragCancel();
      activePointerId = null;
      dragStarted = false;
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
    };
  }, []);

  return (
    <View
      ref={wrapRef}
      style={[
        { userSelect: 'none' as any, touchAction: 'none' as any },
        isDragging ? { opacity: 0 } : undefined,
      ]}
    >
      <TileComponent tile={tile} size={size} isNew />
    </View>
  );
}

const BONUS_LABELS: Record<string, string> = {
  TW: 'TW', DW: 'DW', TL: 'TL', DL: 'DL', START: '★',
};

const BONUS_BG: Record<string, string> = {
  TW: Colors.tw, DW: Colors.dw, TL: Colors.tl, DL: Colors.dl, START: Colors.start,
};

export default function BoardComponent({
  board, pendingTiles, selectedTile, onCellPress, onTilePress, isMyTurn, boardRef,
  boardTileDragCallbacks, lastMoveTiles, boardDraggingTileId,
}: Props) {
  const { width, height } = useWindowDimensions();
  const cellSize = computeCellSize(width, height);
  const pendingMap = new Map(pendingTiles.map((t) => [`${t.row},${t.col}`, t]));

  return (
    // No ScrollView — board is sized to fit the screen width exactly
    <View style={[styles.board, { alignSelf: 'center' }]} ref={boardRef}>
      {board.map((rowCells, row) => (
        <View key={row} style={styles.row}>
          {rowCells.map((cell, col) => {
            const pending = pendingMap.get(`${row},${col}`);
            const hasTile = cell.tile !== null || pending !== undefined;
            const bonusBg = cell.bonus ? BONUS_BG[cell.bonus] : Colors.emptyCell;
            const canPlace = isMyTurn && selectedTile && !hasTile;
            const isLastMove = !!cell.tile && (lastMoveTiles?.has(`${row},${col}`) ?? false);

            return (
              <TouchableOpacity
                key={col}
                onPress={() => onCellPress(row, col)}
                disabled={!!pending || !canPlace}
                activeOpacity={0.6}
                style={[
                  styles.cell,
                  {
                    width: cellSize,
                    height: cellSize,
                    backgroundColor: hasTile ? 'transparent' : bonusBg,
                    borderColor: hasTile ? '#333' : '#3D1A28',
                    borderWidth: 0.5,
                  },
                ]}
              >
                {pending ? (
                  <DraggablePendingTile
                    tile={pending}
                    size={cellSize - 2}
                    onTilePress={() => onTilePress?.(pending)}
                    dragCallbacks={boardTileDragCallbacks}
                    isDragging={boardDraggingTileId === pending.id}
                  />
                ) : cell.tile ? (
                  <TileComponent tile={cell.tile} size={cellSize - 2} disabled highlight={isLastMove} />
                ) : cell.bonus ? (
                  <Text style={[
                    styles.bonusText,
                    { fontSize: cellSize * 0.22 },
                    cell.bonus === 'DL' && styles.bonusTextDark,
                  ]}>
                    {BONUS_LABELS[cell.bonus]}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    backgroundColor: Colors.boardBg,
    padding: 2,
    borderRadius: 6,
  },
  row: { flexDirection: 'row' },
  cell: {
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bonusText: {
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '700',
  },
  bonusTextDark: {
    color: 'rgba(45,10,30,0.85)', // #2D0A1E at 85% — 8:1 on #64B5F6 vs 2.2:1 for white
  },
});
