import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
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
// so resizes are picked up correctly. Uses Dimensions (cross-platform) instead of
// window.innerWidth so this works on iOS/Android as well as web.
export function getCellSize(): number {
  const { width, height } = Dimensions.get('window');
  return computeCellSize(width, height);
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
  const tileRef = useRef(tile);
  const onTilePressRef = useRef(onTilePress);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  const dragStartedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const gesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        dragStartedRef.current = false;
        startXRef.current = e.absoluteX;
        startYRef.current = e.absoluteY;
      })
      .onUpdate((e) => {
        const dx = e.absoluteX - startXRef.current;
        const dy = e.absoluteY - startYRef.current;
        if (!dragStartedRef.current &&
            (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          dragStartedRef.current = true;
          dragCallbacksRef.current?.onDragStart(tileRef.current, e.absoluteX, e.absoluteY);
        }
        if (dragStartedRef.current) {
          dragCallbacksRef.current?.onDragMove(e.absoluteX, e.absoluteY);
        }
      })
      .onEnd((e) => {
        if (dragStartedRef.current) {
          dragCallbacksRef.current?.onDragEnd(e.absoluteX, e.absoluteY, tileRef.current);
        } else {
          onTilePressRef.current();
        }
        dragStartedRef.current = false;
      })
      .onFinalize(() => {
        if (dragStartedRef.current) {
          dragCallbacksRef.current?.onDragCancel();
          dragStartedRef.current = false;
        }
      }),
  []);

  return (
    <GestureDetector gesture={gesture}>
      <View style={isDragging ? { opacity: 0 } : undefined}>
        <TileComponent tile={tile} size={size} isNew />
      </View>
    </GestureDetector>
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
    // Solid white (not 85% opacity) so bonus labels reach WCAG AAA on the
    // deepened bonus-square colors.
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bonusTextDark: {
    color: Colors.text,
  },
});
