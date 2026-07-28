import { applyRackOrder, moveRackTile } from '../src/engine/rackOrder';
import { Tile } from '../src/types';

function tile(id: string): Tile {
  return { id, letter: id.toUpperCase(), value: 1 };
}

describe('applyRackOrder', () => {
  const rack = ['a', 'b', 'c', 'd'].map(tile);

  test('applies a saved tile ID order', () => {
    expect(applyRackOrder(rack, ['c', 'a', 'd', 'b']).map((t) => t.id))
      .toEqual(['c', 'a', 'd', 'b']);
  });

  test('appends newly drawn tiles after the retained custom order', () => {
    expect(applyRackOrder(rack, ['c', 'a', 'b']).map((t) => t.id))
      .toEqual(['c', 'a', 'b', 'd']);
  });

  test('ignores stale and duplicate saved IDs', () => {
    expect(applyRackOrder(rack, ['stale', 'c', 'c', 'a']).map((t) => t.id))
      .toEqual(['c', 'a', 'b', 'd']);
  });

  test.each<[Tile[]]>([
    [[]],
    [[tile('a')]],
  ])('safely handles a rack with fewer than two tiles', (smallRack) => {
    expect(applyRackOrder(smallRack, ['a'])).toEqual(smallRack);
  });

  test('uses natural rack order when no saved order exists', () => {
    expect(applyRackOrder(rack, null)).toEqual(rack);
  });
});

describe('moveRackTile', () => {
  test('moves a tile to the right', () => {
    expect(moveRackTile(['a', 'b', 'c', 'd'], 'b', 3))
      .toEqual(['a', 'c', 'd', 'b']);
  });

  test('moves a tile to the left', () => {
    expect(moveRackTile(['a', 'b', 'c', 'd'], 'd', 1))
      .toEqual(['a', 'd', 'b', 'c']);
  });

  test('clamps target indices to the order bounds', () => {
    expect(moveRackTile(['a', 'b', 'c'], 'b', -20)).toEqual(['b', 'a', 'c']);
    expect(moveRackTile(['a', 'b', 'c'], 'b', 20)).toEqual(['a', 'c', 'b']);
  });

  test('is a no-op for missing tile IDs and short orders', () => {
    expect(moveRackTile(['a', 'b'], 'missing', 0)).toEqual(['a', 'b']);
    expect(moveRackTile([], 'a', 0)).toEqual([]);
    expect(moveRackTile(['a'], 'a', 10)).toEqual(['a']);
  });
});
