import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Tile } from '../types';
import TileComponent from './TileComponent';
import { Colors } from '../utils/colors';

// Movement (in CSS pixels) before we consider a press to be a drag instead of a tap.
const DRAG_THRESHOLD = 5;

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
};

function DraggableTile({
  tile, selected, onTilePress, disabled, dragCallbacks, isDragging, highlight,
}: {
  tile: Tile;
  selected: boolean;
  onTilePress: () => void;
  disabled?: boolean;
  dragCallbacks?: DragCallbacks;
  isDragging?: boolean;
  highlight?: boolean;
}) {
  const wrapRef = useRef<View>(null);
  // Latest values via refs so the (mount-time) listeners always see fresh props.
  const tileRef = useRef(tile);
  const disabledRef = useRef(disabled);
  const onTilePressRef = useRef(onTilePress);
  const dragCallbacksRef = useRef(dragCallbacks);
  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);
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
      if (disabledRef.current) return;
      if (activePointerId !== null) return; // ignore secondary touches
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
        // Block default touch behaviour (scroll/long-press) once a drag is underway.
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
    // touchAction:'none' is critical for mobile/PWA — without it the browser would
    // try to scroll/zoom on touchmove and steal the gesture before our drag fires.
    <View
      ref={wrapRef}
      style={{
        opacity: isDragging ? 0.3 : 1,
        userSelect: 'none' as any,
        touchAction: 'none' as any,
      }}
    >
      <TileComponent
        tile={tile}
        selected={selected}
        size={46}
        disabled={disabled}
        highlight={highlight}
      />
    </View>
  );
}

export default function TileRack({
  tiles, selectedTileId, onTilePress, disabled, swapSelectedIds, recentlyDrawnIds, dragCallbacks, draggingTileId,
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
            highlight={recentlyDrawnIds?.has(tile.id) ?? false}
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
