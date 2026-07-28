import React, { useRef, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Tile } from '../types';
import TileComponent from './TileComponent';
import { Colors } from '../utils/colors';
import {
  getRackDragDirection,
  getRackDragVisualOffset,
  getRackGestureEndAction,
  getRackReorderTarget,
  RackDragDirection,
} from './tileRackGesture';

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
  organizationEnabled?: boolean;
  onReorder?: (tileId: string, targetIndex: number) => void;
  swapSelectedIds?: string[];
  recentlyDrawnIds?: Set<string>;
  dragCallbacks?: DragCallbacks;
  draggingTileId?: string | null;
  onShuffle?: () => void;
};

function DraggableTile({
  tile, index, selected, onTilePress, disabled, organizationEnabled, onReorder,
  dragCallbacks, isDragging, highlight, size,
}: {
  tile: Tile;
  index: number;
  selected: boolean;
  onTilePress: () => void;
  disabled?: boolean;
  organizationEnabled?: boolean;
  onReorder?: (tileId: string, targetIndex: number) => void;
  dragCallbacks?: DragCallbacks;
  isDragging?: boolean;
  highlight?: boolean;
  size: number;
}) {
  // Keep latest prop values accessible inside the gesture (created once at mount).
  const tileRef = useRef(tile);
  const indexRef = useRef(index);
  const sizeRef = useRef(size);
  const disabledRef = useRef(disabled);
  const organizationEnabledRef = useRef(organizationEnabled);
  const onTilePressRef = useRef(onTilePress);
  const onReorderRef = useRef(onReorder);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { organizationEnabledRef.current = organizationEnabled; }, [organizationEnabled]);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  // Drag state tracked in refs so gesture callbacks stay allocation-free.
  const dragDirectionRef = useRef<RackDragDirection | null>(null);
  const boardDragStartedRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const horizontalDragX = useRef(new Animated.Value(0)).current;
  const [isHorizontalDragging, setIsHorizontalDragging] = useState(false);

  const gesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        if (disabledRef.current && !organizationEnabledRef.current) return;
        dragDirectionRef.current = null;
        boardDragStartedRef.current = false;
        horizontalDragX.setValue(0);
        setIsHorizontalDragging(false);
        startXRef.current = e.absoluteX;
        startYRef.current = e.absoluteY;
      })
      .onUpdate((e) => {
        if (disabledRef.current && !organizationEnabledRef.current) return;
        const dx = e.absoluteX - startXRef.current;
        const dy = e.absoluteY - startYRef.current;

        if (!dragDirectionRef.current) {
          dragDirectionRef.current = getRackDragDirection(dx, dy);
          if (dragDirectionRef.current === 'horizontal') {
            setIsHorizontalDragging(true);
          } else if (dragDirectionRef.current === 'vertical' && !disabledRef.current) {
            boardDragStartedRef.current = true;
            dragCallbacksRef.current?.onDragStart(tileRef.current, e.absoluteX, e.absoluteY);
          }
        }

        if (dragDirectionRef.current === 'horizontal') {
          horizontalDragX.setValue(getRackDragVisualOffset(dragDirectionRef.current, dx));
        } else if (dragDirectionRef.current === 'vertical' && boardDragStartedRef.current) {
          dragCallbacksRef.current?.onDragMove(e.absoluteX, e.absoluteY);
        }
      })
      .onEnd((e) => {
        const action = getRackGestureEndAction(
          dragDirectionRef.current,
          !disabledRef.current,
          organizationEnabledRef.current ?? false
        );
        if (action === 'reorder') {
          const dx = e.absoluteX - startXRef.current;
          const tileStride = sizeRef.current + 4;
          const targetIndex = getRackReorderTarget(indexRef.current, dx, tileStride);
          onReorderRef.current?.(tileRef.current.id, targetIndex);
        } else if (action === 'board-drag' && boardDragStartedRef.current) {
          dragCallbacksRef.current?.onDragEnd(e.absoluteX, e.absoluteY, tileRef.current);
        } else if (action === 'press') {
          onTilePressRef.current();
        }
        dragDirectionRef.current = null;
        boardDragStartedRef.current = false;
        horizontalDragX.setValue(0);
        setIsHorizontalDragging(false);
      })
      .onFinalize(() => {
        // Fires on cancel (e.g. interrupted by a call) — clean up if mid-drag.
        if (boardDragStartedRef.current) {
          dragCallbacksRef.current?.onDragCancel();
        }
        dragDirectionRef.current = null;
        boardDragStartedRef.current = false;
        horizontalDragX.setValue(0);
        setIsHorizontalDragging(false);
      }),
  []); // created once; all changing props/state are accessed via refs above

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.draggableTile,
          {
            opacity: isDragging ? 0.3 : 1,
            zIndex: isHorizontalDragging ? 20 : 1,
            elevation: isHorizontalDragging ? 12 : 0,
            shadowOpacity: isHorizontalDragging ? 0.4 : 0,
            shadowRadius: isHorizontalDragging ? 7 : 0,
            transform: [
              { translateX: horizontalDragX },
              { scale: isHorizontalDragging ? 1.08 : 1 },
            ],
          },
        ]}
      >
        <TileComponent
          tile={tile}
          selected={selected}
          size={size}
          disabled={disabled}
          highlight={highlight}
        />
      </Animated.View>
    </GestureDetector>
  );
}

export default function TileRack({
  tiles, selectedTileId, onTilePress, disabled, organizationEnabled, onReorder,
  swapSelectedIds, recentlyDrawnIds, dragCallbacks, draggingTileId, onShuffle,
}: Props) {
  const { width } = useWindowDimensions();
  // Fit 7 tiles + rack padding (16) + shuffle button & gap (48) + screen margin (16)
  // in the viewport; each tile carries 4px of margin on top of its size.
  const tileSize = Math.max(32, Math.min(MAX_TILE_SIZE, Math.floor((width - 80) / 7) - 4));

  return (
    <View style={styles.container}>
      <View style={styles.rackRow}>
        <View style={styles.rack}>
          {tiles.map((tile, index) => (
            <DraggableTile
              key={tile.id}
              tile={tile}
              index={index}
              selected={tile.id === selectedTileId || (swapSelectedIds?.includes(tile.id) ?? false)}
              onTilePress={() => onTilePress(tile)}
              disabled={disabled}
              organizationEnabled={organizationEnabled}
              onReorder={onReorder}
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
  draggableTile: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
  },
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
