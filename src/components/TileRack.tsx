import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { Tile } from '../types';
import TileComponent from './TileComponent';
import { Colors } from '../utils/colors';

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
  dragCallbacks?: DragCallbacks;
  draggingTileId?: string | null;
};

function DraggableTile({
  tile, selected, onTilePress, disabled, dragCallbacks, isDragging,
}: {
  tile: Tile;
  selected: boolean;
  onTilePress: () => void;
  disabled?: boolean;
  dragCallbacks?: DragCallbacks;
  isDragging?: boolean;
}) {
  // Refs so the PanResponder (created once) always calls the latest prop values
  const onTilePressRef = useRef(onTilePress);
  const disabledRef = useRef(disabled);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { onTilePressRef.current = onTilePress; }, [onTilePress]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
  useEffect(() => { dragCallbacksRef.current = dragCallbacks; }, [dragCallbacks]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_e, gs) =>
        Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,

      onPanResponderGrant: (e) => {
        dragCallbacksRef.current?.onDragStart(tile, e.nativeEvent.pageX, e.nativeEvent.pageY);
      },
      onPanResponderMove: (e) => {
        dragCallbacksRef.current?.onDragMove(e.nativeEvent.pageX, e.nativeEvent.pageY);
      },
      onPanResponderRelease: (e, gs) => {
        const dist = Math.sqrt(gs.dx ** 2 + gs.dy ** 2);
        if (dist < 8) {
          onTilePressRef.current();
        } else {
          dragCallbacksRef.current?.onDragEnd(e.nativeEvent.pageX, e.nativeEvent.pageY, tile);
        }
      },
      onPanResponderTerminate: () => {
        dragCallbacksRef.current?.onDragCancel();
      },
    })
  ).current;

  return (
    <View {...pan.panHandlers} style={{ opacity: isDragging ? 0.3 : 1 }}>
      <TileComponent
        tile={tile}
        selected={selected}
        size={46}
        disabled={disabled}
      />
    </View>
  );
}

export default function TileRack({
  tiles, selectedTileId, onTilePress, disabled, swapSelectedIds, dragCallbacks, draggingTileId,
}: Props) {
  return (
    <View style={styles.container}>
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
          />
        ))}
        {Array.from({ length: Math.max(0, 7 - tiles.length) }).map((_, i) => (
          <View key={`empty-${i}`} style={styles.emptySlot} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 10 },
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
    width: 46,
    height: 46,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    margin: 2,
  },
});
