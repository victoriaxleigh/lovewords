export type RackDragMode = 'rack' | 'board';
export type RackGestureEndAction = 'reorder' | 'board-drag' | 'press' | 'none';

export const RACK_DRAG_THRESHOLD = 5;
export const BOARD_MODE_ENTER_DY = -28;
export const BOARD_MODE_EXIT_DY = -12;

export function getRackDragMode(
  currentMode: RackDragMode | null,
  dx: number,
  dy: number,
  boardDragEnabled: boolean
): RackDragMode | null {
  if (
    currentMode === null &&
    Math.abs(dx) <= RACK_DRAG_THRESHOLD &&
    Math.abs(dy) <= RACK_DRAG_THRESHOLD
  ) {
    return null;
  }

  if (currentMode === 'board') {
    return !boardDragEnabled || dy >= BOARD_MODE_EXIT_DY ? 'rack' : 'board';
  }

  if (boardDragEnabled && dy <= BOARD_MODE_ENTER_DY) {
    return 'board';
  }

  return 'rack';
}

export function getRackGestureEndAction(
  mode: RackDragMode | null,
  boardDragEnabled: boolean,
  organizationEnabled: boolean,
  pressEnabled: boolean
): RackGestureEndAction {
  if (mode === 'rack' && organizationEnabled) return 'reorder';
  if (mode === 'board' && boardDragEnabled) return 'board-drag';
  if (mode === null && pressEnabled) return 'press';
  return 'none';
}

export function getRackReorderTarget(
  tileIndex: number,
  horizontalTranslation: number,
  tileStride: number
): number {
  return tileIndex + Math.round(horizontalTranslation / tileStride);
}

export function getRackSiblingPreviewOffset(
  tileIndex: number,
  sourceIndex: number,
  targetIndex: number,
  tileStride: number
): number {
  if (targetIndex > sourceIndex && tileIndex > sourceIndex && tileIndex <= targetIndex) {
    return -tileStride;
  }
  if (targetIndex < sourceIndex && tileIndex >= targetIndex && tileIndex < sourceIndex) {
    return tileStride;
  }
  return 0;
}
