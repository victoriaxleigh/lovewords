import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
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
  getRackDragMode,
  getRackGestureEndAction,
  getRackReorderTarget,
  getRackSiblingPreviewOffset,
  RackDragMode,
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
  dragCallbacks, isDragging, highlight, size, tileCount, previewOffset,
  onPreviewChange, onPreviewClear,
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
  tileCount: number;
  previewOffset: number;
  onPreviewChange: (sourceIndex: number, targetIndex: number) => void;
  onPreviewClear: () => void;
}) {
  // Keep latest prop values accessible inside the gesture (created once at mount).
  const tileRef = useRef(tile);
  const indexRef = useRef(index);
  const sizeRef = useRef(size);
  const tileCountRef = useRef(tileCount);
  const disabledRef = useRef(disabled);
  const organizationEnabledRef = useRef(organizationEnabled);
  const onTilePressRef = useRef(onTilePress);
  const onReorderRef = useRef(onReorder);
  const dragCallbacksRef = useRef(dragCallbacks);
  const onPreviewChangeRef = useRef(onPreviewChange);
  const onPreviewClearRef = useRef(onPreviewClear);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { indexRef.current = index; }, [index]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => { tileCountRef.current = tileCount; }, [tileCount]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { organizationEnabledRef.current = organizationEnabled; }, [organizationEnabled]);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { onReorderRef.current = onReorder; }, [onReorder]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);
  useEffect(() => { onPreviewChangeRef.current = onPreviewChange; }, [onPreviewChange]);
  useEffect(() => { onPreviewClearRef.current = onPreviewClear; }, [onPreviewClear]);

  // Drag state tracked in refs so gesture callbacks stay allocation-free.
  const dragModeRef = useRef<RackDragMode | null>(null);
  const boardDragStartedRef = useRef(false);
  const activeDragCallbacksRef = useRef<DragCallbacks | null>(null);
  const previewTargetRef = useRef(index);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const rackDragXY = useRef(new Animated.ValueXY()).current;
  const siblingPreviewX = useRef(new Animated.Value(previewOffset)).current;
  const [isLifted, setIsLifted] = useState(false);

  useEffect(() => {
    siblingPreviewX.stopAnimation();
    Animated.spring(siblingPreviewX, {
      toValue: previewOffset,
      useNativeDriver: true,
      speed: 28,
      bounciness: 0,
    }).start();
  }, [previewOffset, siblingPreviewX]);

  const gesture = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .minDistance(0)
      .onBegin((e) => {
        if (disabledRef.current && !organizationEnabledRef.current) return;
        dragModeRef.current = null;
        boardDragStartedRef.current = false;
        activeDragCallbacksRef.current = null;
        previewTargetRef.current = indexRef.current;
        rackDragXY.setValue({ x: 0, y: 0 });
        setIsLifted(false);
        onPreviewClearRef.current();
        startXRef.current = e.absoluteX;
        startYRef.current = e.absoluteY;
      })
      .onUpdate((e) => {
        if (disabledRef.current && !organizationEnabledRef.current) return;
        const dx = e.absoluteX - startXRef.current;
        const dy = e.absoluteY - startYRef.current;
        const boardDragEnabled =
          !disabledRef.current && dragCallbacksRef.current !== undefined;
        const nextMode = getRackDragMode(
          dragModeRef.current,
          dx,
          dy,
          boardDragEnabled
        );
        const modeChanged = nextMode !== dragModeRef.current;

        if (modeChanged) {
          if (dragModeRef.current === 'board' && boardDragStartedRef.current) {
            activeDragCallbacksRef.current?.onDragCancel();
            boardDragStartedRef.current = false;
            activeDragCallbacksRef.current = null;
          }

          dragModeRef.current = nextMode;
          if (nextMode !== null) {
            setIsLifted(true);
          }
          if (nextMode === 'board') {
            rackDragXY.setValue({ x: 0, y: 0 });
            onPreviewClearRef.current();
            boardDragStartedRef.current = true;
            activeDragCallbacksRef.current = dragCallbacksRef.current ?? null;
            activeDragCallbacksRef.current?.onDragStart(
              tileRef.current,
              e.absoluteX,
              e.absoluteY
            );
          }
        }

        if (dragModeRef.current === 'rack') {
          rackDragXY.setValue({ x: dx, y: dy });
          const tileStride = sizeRef.current + 4;
          const unclampedTarget = getRackReorderTarget(
            indexRef.current,
            dx,
            tileStride
          );
          const targetIndex = Math.max(
            0,
            Math.min(tileCountRef.current - 1, unclampedTarget)
          );
          if (targetIndex !== previewTargetRef.current) {
            previewTargetRef.current = targetIndex;
            onPreviewChangeRef.current(indexRef.current, targetIndex);
          } else if (modeChanged) {
            onPreviewChangeRef.current(indexRef.current, targetIndex);
          }
        } else if (dragModeRef.current === 'board' && boardDragStartedRef.current) {
          activeDragCallbacksRef.current?.onDragMove(e.absoluteX, e.absoluteY);
        }
      })
      .onEnd((e) => {
        const boardDragEnabled =
          boardDragStartedRef.current && activeDragCallbacksRef.current !== null;
        const action = getRackGestureEndAction(
          dragModeRef.current,
          boardDragEnabled,
          organizationEnabledRef.current ?? false,
          !disabledRef.current
        );
        if (action === 'reorder') {
          onReorderRef.current?.(tileRef.current.id, previewTargetRef.current);
        } else if (action === 'board-drag' && boardDragStartedRef.current) {
          activeDragCallbacksRef.current?.onDragEnd(
            e.absoluteX,
            e.absoluteY,
            tileRef.current
          );
        } else if (action === 'press') {
          onTilePressRef.current();
        }
        dragModeRef.current = null;
        boardDragStartedRef.current = false;
        activeDragCallbacksRef.current = null;
        rackDragXY.setValue({ x: 0, y: 0 });
        setIsLifted(false);
        onPreviewClearRef.current();
      })
      .onFinalize(() => {
        // Fires on cancel (e.g. interrupted by a call) — clean up if mid-drag.
        if (boardDragStartedRef.current) {
          activeDragCallbacksRef.current?.onDragCancel();
        }
        dragModeRef.current = null;
        boardDragStartedRef.current = false;
        activeDragCallbacksRef.current = null;
        rackDragXY.setValue({ x: 0, y: 0 });
        setIsLifted(false);
        onPreviewClearRef.current();
      }),
  []); // created once; all changing props/state are accessed via refs above

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.draggableTile,
          {
            opacity: isDragging ? 0.3 : 1,
            zIndex: isLifted ? 20 : 1,
            elevation: isLifted ? 12 : 0,
            shadowOpacity: isLifted ? 0.4 : 0,
            shadowRadius: isLifted ? 7 : 0,
            transform: [
              { translateX: Animated.add(rackDragXY.x, siblingPreviewX) },
              { translateY: rackDragXY.y },
              { scale: isLifted ? 1.08 : 1 },
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
  const [dragPreview, setDragPreview] = useState<{
    sourceIndex: number;
    targetIndex: number;
  } | null>(null);
  // Fit 7 tiles + rack padding (16) + shuffle button & gap (48) + screen margin (16)
  // in the viewport; each tile carries 4px of margin on top of its size.
  const tileSize = Math.max(32, Math.min(MAX_TILE_SIZE, Math.floor((width - 80) / 7) - 4));
  const tileStride = tileSize + 4;
  const handlePreviewChange = useCallback((sourceIndex: number, targetIndex: number) => {
    setDragPreview({ sourceIndex, targetIndex });
  }, []);
  const handlePreviewClear = useCallback(() => {
    setDragPreview(null);
  }, []);

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
              tileCount={tiles.length}
              previewOffset={dragPreview
                ? getRackSiblingPreviewOffset(
                    index,
                    dragPreview.sourceIndex,
                    dragPreview.targetIndex,
                    tileStride
                  )
                : 0}
              onPreviewChange={handlePreviewChange}
              onPreviewClear={handlePreviewClear}
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
