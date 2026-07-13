import React, { useRef, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Tile } from '../types';
import TileComponent from './TileComponent';
import { Colors } from '../utils/colors';

const DRAG_THRESHOLD = 5;
const MAX_TILE_SIZE = 46;

export type DragCallbacks = {
  onDragStart: (tile: Tile, pageX: number, pageY: number) => void;
  onDragMove: (pageX: number, pageY: number) => void;
  onDragEnd: (pageX: number, pageY: number, tile: Tile) => void;
  onDragCancel: () => void;
};

type Props = {
  tiles: Tile[];
  selectedTileId: string | null;
  onTilePress: (tile: Tile) => void;
  disabled?: boolean;
  swapSelectedIds?: string[];
  recentlyDrawnIds?: Set<string>;
  dragCallbacks?: DragCallbacks;
  draggingTileId?: string | null;
  onShuffle?: () => void;
};

function DraggableTile({
  tile, selected, onTilePress, disabled, dragCallbacks, isDragging, highlight, size,
}: {
  tile: Tile;
  selected: boolean;
  onTilePress: () => void;
  disabled?: boolean;
  dragCallbacks?: DragCallbacks;
  isDragging?: boolean;
  highlight?: boolean;
  size: number;
}) {
  // Keep latest prop values accessible inside the gesture (created once at mount).
  const tileRef = useRef(tile);
  const disabledRef = useRef(disabled);
  const onTilePressRef = useRef(onTilePress);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  // Drag state tracked in refs so gesture callbacks stay allocation-free.
  const dragStartedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const gesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        if (disabledRef.current) return;
        dragStartedRef.current = false;
        startXRef.current = e.absoluteX;
        startYRef.current = e.absoluteY;
      })
      .onUpdate((e) => {
        if (disabledRef.current) return;
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
        } else if (!disabledRef.current) {
          onTilePressRef.current();
        }
        dragStartedRef.current = false;
      })
      .onFinalize(() => {
        // Fires on cancel (e.g. interrupted by a call) — clean up if mid-drag.
        if (dragStartedRef.current) {
          dragCallbacksRef.current?.onDragCancel();
          dragStartedRef.current = false;
        }
      }),
  []); // created once; all mutable state accessed via refs above

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ opacity: isDragging ? 0.3 : 1 }}>
        <TileComponent
          tile={tile}
          selected={selected}
          size={size}
          disabled={disabled}
          highlight={highlight}
        />
      </View>
    </GestureDetector>
  );
}

export default function TileRack({
  tiles, selectedTileId, onTilePress, disabled, swapSelectedIds, recentlyDrawnIds, dragCallbacks, draggingTileId, onShuffle,
}: Props) {
  const { width } = useWindowDimensions();
  // Fit 7 tiles + rack padding (16) + shuffle button & gap (48) + screen margin (16)
  // in the viewport; each tile carries 4px of margin on top of its size.
  const tileSize = Math.max(32, Math.min(MAX_TILE_SIZE, Math.floor((width - 80) / 7) - 4));

  return (
    <View style={styles.container}>
      <View style={styles.rackRow}>
        <View style={styles.rack}>
          {tiles.map((tile) => (
            <DraggableTile
              key={tile.id}
              tile={tile}
              selected={tile.id === selectedTileId || (swapSelectedIds?.includes(tile.id) ?? false)}
              onTilePress={() => onTilePress(tile)}
              disabled={disabled}
              dragCallbacks={dragCallbacks}
              isDragging={tile.id === draggingTileId}
              highlight={recentlyDrawnIds?.has(tile.id) ?? false}
              size={tileSize}
            />
          ))}
          {Array.from({ length: Math.max(0, 7 - tiles.length) }).map((_, i) => (
            <View key={`empty-${i}`} style={[styles.emptySlot, { width: tileSize, height: tileSize }]} />
          ))}
        </View>
        {onShuffle && (
          <TouchableOpacity
            style={[styles.shuffleBtn, tiles.length < 2 && styles.shuffleBtnDisabled]}
            onPress={onShuffle}
            disabled={tiles.length < 2}
            accessibilityLabel="Shuffle rack"
            accessibilityRole="button"
          >
            <Text style={styles.shuffleIcon}>🔀</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 10 },
  rackRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rack: {
    flexDirection: 'row',
    backgroundColor: '#5C2A3E',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 6,
  },
  emptySlot: {
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    margin: 2,
  },
  shuffleBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shuffleBtnDisabled: { opacity: 0.4 },
  shuffleIcon: { fontSize: 22 },
});
