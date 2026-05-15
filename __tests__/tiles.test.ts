import { createTileBag, drawTiles, exchangeTiles, shuffle } from '../src/engine/tiles';

describe('Tile Bag', () => {
  test('creates exactly 100 tiles', () => {
    const bag = createTileBag();
    expect(bag).toHaveLength(100);
  });

  test('contains exactly 2 blank tiles', () => {
    const bag = createTileBag();
    const blanks = bag.filter((t) => t.isBlank);
    expect(blanks).toHaveLength(2);
  });

  test('contains exactly 12 E tiles', () => {
    const bag = createTileBag();
    const eTiles = bag.filter((t) => t.letter === 'E');
    expect(eTiles).toHaveLength(12);
  });

  test('contains exactly 1 Z tile worth 10 points', () => {
    const bag = createTileBag();
    const zTiles = bag.filter((t) => t.letter === 'Z');
    expect(zTiles).toHaveLength(1);
    expect(zTiles[0].value).toBe(10);
  });

  test('all tiles have unique IDs', () => {
    const bag = createTileBag();
    const ids = bag.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);
  });

  test('blank tiles are worth 0 points', () => {
    const bag = createTileBag();
    const blanks = bag.filter((t) => t.isBlank);
    blanks.forEach((t) => expect(t.value).toBe(0));
  });
});

describe('drawTiles', () => {
  test('draws the correct number of tiles', () => {
    const bag = createTileBag();
    const { drawn, remaining } = drawTiles(bag, 7);
    expect(drawn).toHaveLength(7);
    expect(remaining).toHaveLength(93);
  });

  test('drawn tiles are removed from remaining', () => {
    const bag = createTileBag();
    const { drawn, remaining } = drawTiles(bag, 7);
    const drawnIds = new Set(drawn.map((t) => t.id));
    remaining.forEach((t) => expect(drawnIds.has(t.id)).toBe(false));
  });

  test('drawing 0 tiles returns empty array', () => {
    const bag = createTileBag();
    const { drawn, remaining } = drawTiles(bag, 0);
    expect(drawn).toHaveLength(0);
    expect(remaining).toHaveLength(100);
  });

  test('drawing all tiles leaves empty bag', () => {
    const bag = createTileBag();
    const { drawn, remaining } = drawTiles(bag, 100);
    expect(drawn).toHaveLength(100);
    expect(remaining).toHaveLength(0);
  });
});

describe('exchangeTiles', () => {
  test('returns same rack size after exchange', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const tilesToExchange = rack.slice(0, 3);
    const { newRack } = exchangeTiles(rack, tilesToExchange, remaining);
    expect(newRack).toHaveLength(7);
  });

  test('exchanged tiles go back into bag', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 7);
    const tilesToExchange = rack.slice(0, 3);
    const { newBag } = exchangeTiles(rack, tilesToExchange, remaining);
    // Bag should have 93 (remaining) + 3 (returned) - 3 (drawn) = 93
    expect(newBag).toHaveLength(93);
  });

  test('throws if not enough tiles in bag', () => {
    const bag = createTileBag();
    const { drawn: rack, remaining } = drawTiles(bag, 97); // only 3 left
    const tilesToExchange = rack.slice(0, 7);
    expect(() => exchangeTiles(rack, tilesToExchange, remaining)).toThrow();
  });
});

describe('shuffle', () => {
  test('returns same number of elements', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(shuffle(arr)).toHaveLength(5);
  });

  test('contains all the same elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffle(arr);
    expect(shuffled.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  test('does not mutate the original array', () => {
    const arr = [1, 2, 3, 4, 5];
    shuffle(arr);
    expect(arr).toEqual([1, 2, 3, 4, 5]);
  });
});
