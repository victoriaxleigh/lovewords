export type RackDragDirection = 'horizontal' | 'vertical';
export type RackGestureEndAction = 'reorder' | 'board-drag' | 'press' | 'none';

export const RACK_DRAG_THRESHOLD = 5;

export function getRackDragDirection(
  dx: number,
  dy: number
): RackDragDirection | null {
  if (Math.abs(dx) <= RACK_DRAG_THRESHOLD && Math.abs(dy) <= RACK_DRAG_THRESHOLD) {
    return null;
  }
  return Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
}

export function getRackGestureEndAction(
  direction: RackDragDirection | null,
  gameplayEnabled: boolean,
  organizationEnabled: boolean
): RackGestureEndAction {
  if (direction === 'horizontal' && organizationEnabled) return 'reorder';
  if (direction === 'vertical' && gameplayEnabled) return 'board-drag';
  if (direction === null && gameplayEnabled) return 'press';
  return 'none';
}

export function getRackReorderTarget(
  tileIndex: number,
  horizontalTranslation: number,
  tileStride: number
): number {
  return tileIndex + Math.round(horizontalTranslation / tileStride);
}
