type RackTile = {
  id: string;
};

/**
 * Applies a local tile ID order to the current rack.
 *
 * Stale IDs are ignored and tiles that are not in the saved order are appended
 * in their current rack order.
 */
export function applyRackOrder<T extends RackTile>(
  rack: readonly T[],
  savedOrder: readonly string[] | null | undefined
): T[] {
  if (rack.length < 2 || !savedOrder || savedOrder.length === 0) {
    return [...rack];
  }

  const tilesById = new Map(rack.map((tile) => [tile.id, tile]));
  const ordered: T[] = [];
  const addedIds = new Set<string>();

  for (const id of savedOrder) {
    const tile = tilesById.get(id);
    if (tile && !addedIds.has(id)) {
      ordered.push(tile);
      addedIds.add(id);
    }
  }

  for (const tile of rack) {
    if (!addedIds.has(tile.id)) {
      ordered.push(tile);
    }
  }

  return ordered;
}

/**
 * Moves a tile ID within an order, clamping the destination to its bounds.
 */
export function moveRackTile(
  order: readonly string[],
  tileId: string,
  targetIndex: number
): string[] {
  if (order.length < 2) return [...order];

  const sourceIndex = order.indexOf(tileId);
  if (sourceIndex === -1) return [...order];

  const finiteTarget = Number.isFinite(targetIndex) ? Math.trunc(targetIndex) : sourceIndex;
  const clampedTarget = Math.max(0, Math.min(order.length - 1, finiteTarget));
  if (sourceIndex === clampedTarget) return [...order];

  const moved = [...order];
  moved.splice(sourceIndex, 1);
  moved.splice(clampedTarget, 0, tileId);
  return moved;
}
