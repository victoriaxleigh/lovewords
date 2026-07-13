import { Tile } from '../types';

// Words With Friends tile distribution + values (104 tiles total).
// Previously this was a hybrid (Scrabble counts + WWF values), which felt
// punishing — too few S/T/H/D combined with high penalty values on rough
// letters. Pure WWF gives more common letters so racks build words more
// easily; the WWF values (V=5, J/Z=10, B/C/F/M=4) still reward landing
// the rare tiles. Difference from Scrabble: D 4→5, E 12→13, H 2→4,
// I 9→8, N 6→5, S 4→5, T 6→7.
const TILE_DISTRIBUTION: { letter: string; value: number; count: number }[] = [
  { letter: 'A', value: 1, count: 9 },
  { letter: 'B', value: 4, count: 2 },
  { letter: 'C', value: 4, count: 2 },
  { letter: 'D', value: 2, count: 5 },
  { letter: 'E', value: 1, count: 13 },
  { letter: 'F', value: 4, count: 2 },
  { letter: 'G', value: 3, count: 3 },
  { letter: 'H', value: 3, count: 4 },
  { letter: 'I', value: 1, count: 8 },
  { letter: 'J', value: 10, count: 1 },
  { letter: 'K', value: 5, count: 1 },
  { letter: 'L', value: 2, count: 4 },
  { letter: 'M', value: 4, count: 2 },
  { letter: 'N', value: 2, count: 5 },
  { letter: 'O', value: 1, count: 8 },
  { letter: 'P', value: 4, count: 2 },
  { letter: 'Q', value: 10, count: 1 },
  { letter: 'R', value: 1, count: 6 },
  { letter: 'S', value: 1, count: 5 },
  { letter: 'T', value: 1, count: 7 },
  { letter: 'U', value: 2, count: 4 },
  { letter: 'V', value: 5, count: 2 },
  { letter: 'W', value: 4, count: 2 },
  { letter: 'X', value: 8, count: 1 },
  { letter: 'Y', value: 3, count: 2 },
  { letter: 'Z', value: 10, count: 1 },
  { letter: '', value: 0, count: 2 }, // blanks
];

export function createTileBag(): Tile[] {
  const bag: Tile[] = [];
  for (const { letter, value, count } of TILE_DISTRIBUTION) {
    for (let i = 0; i < count; i++) {
      bag.push({
        id: crypto.randomUUID(),
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
