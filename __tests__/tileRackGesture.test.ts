import {
  BOARD_MODE_ENTER_DY,
  BOARD_MODE_EXIT_DY,
  getRackDragMode,
  getRackGestureEndAction,
  getRackReorderTarget,
  getRackSiblingPreviewOffset,
} from '../src/components/tileRackGesture';

describe('TileRack drag mode', () => {
  test('waits for the existing movement threshold before lifting into rack mode', () => {
    expect(getRackDragMode(null, 5, 5, true)).toBeNull();
    expect(getRackDragMode(null, 6, 2, true)).toBe('rack');
    expect(getRackDragMode(null, 2, -6, true)).toBe('rack');
  });

  test('enters board mode only after moving far enough upward', () => {
    expect(getRackDragMode('rack', 0, BOARD_MODE_ENTER_DY + 1, true)).toBe('rack');
    expect(getRackDragMode('rack', 0, BOARD_MODE_ENTER_DY, true)).toBe('board');
  });

  test('uses hysteresis to avoid flipping modes in the boundary band', () => {
    const boundaryDy = (BOARD_MODE_ENTER_DY + BOARD_MODE_EXIT_DY) / 2;
    expect(getRackDragMode('rack', 12, boundaryDy, true)).toBe('rack');
    expect(getRackDragMode('board', 12, boundaryDy, true)).toBe('board');
    expect(getRackDragMode('board', 12, BOARD_MODE_EXIT_DY, true)).toBe('rack');
  });

  test('never enters board mode without actual board drag callbacks', () => {
    expect(getRackDragMode('rack', 0, -100, false)).toBe('rack');
    expect(getRackDragMode('board', 0, -100, false)).toBe('rack');
  });

  test('translates horizontal movement into a rack target index', () => {
    expect(getRackReorderTarget(2, 51, 50)).toBe(3);
    expect(getRackReorderTarget(2, -101, 50)).toBe(0);
  });

  test('shifts siblings out of the previewed insertion slot', () => {
    expect([0, 1, 2, 3, 4].map((index) =>
      getRackSiblingPreviewOffset(index, 1, 4, 50)
    )).toEqual([0, 0, -50, -50, -50]);
    expect([0, 1, 2, 3, 4].map((index) =>
      getRackSiblingPreviewOffset(index, 4, 1, 50)
    )).toEqual([0, 50, 50, 50, 0]);
  });
});

describe('TileRack turn gating', () => {
  test('while waiting, only organization is enabled', () => {
    const boardDragEnabled = false;
    const organizationEnabled = true;
    const pressEnabled = false;

    expect(getRackGestureEndAction('rack', boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('reorder');
    expect(getRackGestureEndAction('board', boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('none');
    expect(getRackGestureEndAction(null, boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('none');
  });

  test("during the player's turn, rack, board, and tap releases stay distinct", () => {
    const boardDragEnabled = true;
    const organizationEnabled = true;
    const pressEnabled = true;

    expect(getRackGestureEndAction('rack', boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('reorder');
    expect(getRackGestureEndAction('board', boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('board-drag');
    expect(getRackGestureEndAction(null, boardDragEnabled, organizationEnabled, pressEnabled))
      .toBe('press');
  });

  test('when the game is inactive, rack gestures are inert', () => {
    expect(getRackGestureEndAction('rack', false, false, false)).toBe('none');
    expect(getRackGestureEndAction('board', false, false, false)).toBe('none');
    expect(getRackGestureEndAction(null, false, false, false)).toBe('none');
  });

  test('tap handling does not imply board drag availability', () => {
    expect(getRackGestureEndAction(null, false, true, true)).toBe('press');
    expect(getRackGestureEndAction('board', false, true, true)).toBe('none');
  });
});
