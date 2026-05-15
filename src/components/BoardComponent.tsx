import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  PanResponder,
} from 'react-native';
import { Board, PlacedTile, Tile } from '../types';
import { BOARD_SIZE } from '../engine/board';
import { Colors } from '../utils/colors';
import TileComponent from './TileComponent';

export const CELL_SIZE = Math.floor((Dimensions.get('window').width - 8) / BOARD_SIZE);

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
  lastMoveTiles?: Set<string>; // "row,col" keys of the most recently committed word
};

function DraggablePendingTile({
  tile, size, onTilePress, dragCallbacks,
}: {
  tile: PlacedTile;
  size: number;
  onTilePress: () => void;
  dragCallbacks?: BoardTileDragCallbacks;
}) {
  const onTilePressRef = useRef(onTilePress);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, gs) => Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,
      onPanResponderGrant: (e) => {
        dragCallbacksRef.current?.onDragStart(tile, e.nativeEvent.pageX, e.nativeEvent.pageY);
      },
      onPanResponderMove: (e) => {
        dragCallbacksRef.current?.onDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
      },
      onPanResponderRelease: (e, gs) => {
        const dist = Math.sqrt(gs.dx ** 2 + gs.dy ** 2);
        if (dist >= 8) {
          dragCallbacksRef.current?.onDragEnd(e.nativeEvent.pageX, e.nativeEvent.pageY, tile);
        } else {
          onTilePressRef.current();
        }
      },
      onPanResponderTerminate: () => {
        dragCallbacksRef.current?.onDragCancel();
      },
    })
  ).current;

  return (
    <View {...pan.panHandlers}>
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
  boardTileDragCallbacks, lastMoveTiles,
}: Props) {
  const pendingMap = new Map(pendingTiles.map((t) => [`${t.row},${t.col}`, t]));

  return (
    // No ScrollView — board is sized to fit the screen width exactly
    <View style={styles.board} ref={boardRef}>
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
                    width: CELL_SIZE,
                    height: CELL_SIZE,
                    backgroundColor: hasTile ? 'transparent' : canPlace ? Colors.emptyCell : bonusBg,
                    borderColor: canPlace ? 'rgba(255,255,255,0.6)' : hasTile ? '#333' : '#3D1A28',
                    borderWidth: canPlace ? 1.5 : 0.5,
                  },
                ]}
              >
                {pending ? (
                  <DraggablePendingTile
                    tile={pending}
                    size={CELL_SIZE - 2}
                    onTilePress={() => onTilePress?.(pending)}
                    dragCallbacks={boardTileDragCallbacks}
                  />
                ) : cell.tile ? (
                  <TileComponent tile={cell.tile} size={CELL_SIZE - 2} disabled highlight={isLastMove} />
                ) : cell.bonus ? (
                  <Text style={[
                    styles.bonusText,
                    { fontSize: CELL_SIZE * 0.22 },
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
