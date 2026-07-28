import {
  getRackDragDirection,
  getRackGestureEndAction,
  getRackReorderTarget,
} from '../src/components/tileRackGesture';

describe('TileRack gesture direction', () => {
  test('waits for the drag threshold before locking a direction', () => {
    expect(getRackDragDirection(5, 5)).toBeNull();
    expect(getRackDragDirection(6, 2)).toBe('horizontal');
    expect(getRackDragDirection(2, -6)).toBe('vertical');
  });

  test('uses the dominant axis and favors horizontal on a tie', () => {
    expect(getRackDragDirection(-20, 10)).toBe('horizontal');
    expect(getRackDragDirection(10, 20)).toBe('vertical');
    expect(getRackDragDirection(10, -10)).toBe('horizontal');
  });

  test('translates horizontal movement into a rack target index', () => {
    expect(getRackReorderTarget(2, 51, 50)).toBe(3);
    expect(getRackReorderTarget(2, -101, 50)).toBe(0);
  });
});

describe('TileRack turn gating', () => {
  test('while waiting, only horizontal organization is enabled', () => {
    const gameplayEnabled = false;
    const organizationEnabled = true;

    expect(getRackGestureEndAction('horizontal', gameplayEnabled, organizationEnabled))
      .toBe('reorder');
    expect(getRackGestureEndAction('vertical', gameplayEnabled, organizationEnabled))
      .toBe('none');
    expect(getRackGestureEndAction(null, gameplayEnabled, organizationEnabled))
      .toBe('none');
  });

  test("during the player's turn, horizontal, vertical, and tap actions stay distinct", () => {
    const gameplayEnabled = true;
    const organizationEnabled = true;

    expect(getRackGestureEndAction('horizontal', gameplayEnabled, organizationEnabled))
      .toBe('reorder');
    expect(getRackGestureEndAction('vertical', gameplayEnabled, organizationEnabled))
      .toBe('board-drag');
    expect(getRackGestureEndAction(null, gameplayEnabled, organizationEnabled))
      .toBe('press');
  });

  test('when the game is inactive, rack gestures are inert', () => {
    expect(getRackGestureEndAction('horizontal', false, false)).toBe('none');
    expect(getRackGestureEndAction('vertical', false, false)).toBe('none');
    expect(getRackGestureEndAction(null, false, false)).toBe('none');
  });
});
