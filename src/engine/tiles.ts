import { Tile } from '../types';

// Standard Scrabble/WWF tile distribution
const TILE_DISTRIBUTION: { letter: string; value: number; count: number }[] = [
  { letter: 'A', value: 1, count: 9 },
  { letter: 'B', value: 4, count: 2 },
  { letter: 'C', value: 4, count: 2 },
  { letter: 'D', value: 2, count: 4 },
  { letter: 'E', value: 1, count: 12 },
  { letter: 'F', value: 4, count: 2 },
  { letter: 'G', value: 3, count: 3 },
  { letter: 'H', value: 3, count: 2 },
  { letter: 'I', value: 1, count: 9 },
  { letter: 'J', value: 10, count: 1 },
  { letter: 'K', value: 5, count: 1 },
  { letter: 'L', value: 2, count: 4 },
  { letter: 'M', value: 4, count: 2 },
  { letter: 'N', value: 2, count: 6 },
  { letter: 'O', value: 1, count: 8 },
  { letter: 'P', value: 4, count: 2 },
  { letter: 'Q', value: 10, count: 1 },
  { letter: 'R', value: 1, count: 6 },
  { letter: 'S', value: 1, count: 4 },
  { letter: 'T', value: 1, count: 6 },
  { letter: 'U', value: 2, count: 4 },
  { letter: 'V', value: 5, count: 2 },
  { letter: 'W', value: 4, count: 2 },
  { letter: 'X', value: 8, count: 1 },
  { letter: 'Y', value: 3, count: 2 },
  { letter: 'Z', value: 10, count: 1 },
  { letter: '', value: 0, count: 2 }, // blanks
];

let _tileIdCounter = 0;

export function createTileBag(): Tile[] {
  const bag: Tile[] = [];
  for (const { letter, value, count } of TILE_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      bag.push({
        id: `tile_${_tileIdCounter++}`,
        letter,
        value,
        isBlank: letter === '',
      });
    }
  }
  return shuffle(bag);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function drawTiles(bag: Tile[], count: number): { drawn: Tile[]; remaining: Tile[] } {
  const drawn = bag.slice(0, count);
  const remaining = bag.slice(count);
  return { drawn, remaining };
}

export function exchangeTiles(
  rack: Tile[],
  tilesToExchange: Tile[],
  bag: Tile[]
): { newRack: Tile[]; newBag: Tile[] } {
  if (bag.length < tilesToExchange.length) {
    throw new Error('Not enough tiles in bag to exchange');
  }
  const exchangeIds = new Set(tilesToExchange.map((t) => t.id));
  const keptTiles = rack.filter((t) => !exchangeIds.has(t.id));
  const newBag = shuffle([...bag, ...tilesToExchange]);
  const { drawn, remaining } = drawTiles(newBag, tilesToExchange.length);
  return {
    newRack: [...keptTiles, ...drawn],
    newBag: remaining,
  };
}
