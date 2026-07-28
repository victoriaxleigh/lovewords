export const FREE_GAME_LIMIT = 3;

export function hasReachedFreeGameLimit(gameCount: number): boolean {
  return gameCount >= FREE_GAME_LIMIT;
}
