/**
 * Tests for swap logic — validates the core swap mechanics
 * without hitting Supabase (we test the logic in isolation).
 */

import { createTileBag, drawTiles } from '../src/engine/tiles';
import { Tile } from '../src/types';

// Recreate the swap logic from gameService so we can test it independently
function performSwap(bag: Tile[], rack: Tile[], tileIdsToSwap: string[]) {
  if (tileIdsToSwap.length === 0) throw new Error('No tiles selected');
  if (bag.length < 7) throw new Error('Not enough tiles in bag');

  const tilesToReturn = rack.filter((t) => tileIdsToSwap.includes(t.id));
  const remainingRack = rack.filter((t) => !tileIdsToSwap.includes(t.id));

  // Return tiles to bag and draw same number
  const newBag = [...bag, ...tilesToReturn].sort(() => Math.random() - 0.5);
  const { drawn, remaining } = drawTiles(newBag, tileIdsToSwap.length);
  const newRack = [...remainingRack, ...drawn];

  return { newRack, newBag: remaining };
}

describe('swap tiles logic', () => {
  test('rack size stays the same after swap', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const idsToSwap = [rack[0].id, rack[1].id];
    const { newRack } = performSwap(remaining, rack, idsToSwap);
    expect(newRack).toHaveLength(7);
  });

  test('swapped tiles are removed from rack', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const idsToSwap = [rack[0].id, rack[1].id];
    const { newRack } = performSwap(remaining, rack, idsToSwap);
    expect(newRack.find((t) => t.id === rack[0].id)).toBeUndefined();
    expect(newRack.find((t) => t.id === rack[1].id)).toBeUndefined();
  });

  test('bag shrinks by number of tiles drawn', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const idsToSwap = [rack[0].id, rack[1].id, rack[2].id];
    const { newBag } = performSwap(remaining, rack, idsToSwap);
    // bag had (104-7)=97 tiles, we return 3 and draw 3, net stays 97
    expect(newBag).toHaveLength(97);
  });

  test('throws when bag has fewer than 7 tiles', () => {
    const { drawn: rack } = drawTiles(createTileBag(), 7);
    const tinyBag: Tile[] = rack.slice(0, 3).map((t) => ({ ...t, id: 'x' + t.id }));
    expect(() => performSwap(tinyBag, rack, [rack[0].id])).toThrow('Not enough tiles');
  });

  test('swapping all 7 tiles still gives back 7', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const { newRack } = performSwap(remaining, rack, rack.map((t) => t.id));
    expect(newRack).toHaveLength(7);
  });

  test('un-swapped tiles are preserved', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const keepTile = rack[4];
    const idsToSwap = rack.filter((t) => t.id !== keepTile.id).map((t) => t.id);
    const { newRack } = performSwap(remaining, rack, idsToSwap);
    expect(newRack.find((t) => t.id === keepTile.id)).toBeDefined();
  });
});
