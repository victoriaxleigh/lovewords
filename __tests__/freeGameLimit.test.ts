import { FREE_GAME_LIMIT, hasReachedFreeGameLimit } from '../src/utils/freeGameLimit';

describe('native free-game limit', () => {
  test('allows accepting an invitation below the quota', () => {
    expect(hasReachedFreeGameLimit(FREE_GAME_LIMIT - 1)).toBe(false);
  });

  test('blocks accepting an invitation at and above the quota', () => {
    expect(hasReachedFreeGameLimit(FREE_GAME_LIMIT)).toBe(true);
    expect(hasReachedFreeGameLimit(FREE_GAME_LIMIT + 1)).toBe(true);
  });
});
