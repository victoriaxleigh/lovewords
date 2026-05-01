import { Board, PlacedTile } from '../types';
import { getCell, BOARD_SIZE } from './board';

type ScoredWord = { word: string; score: number };

/**
 * Score a move. Returns total score and a list of words formed.
 */
export function scoreMove(
  board: Board,
  placedTiles: PlacedTile[]
): { total: number; words: ScoredWord[] } {
  const newTileSet = new Set(placedTiles.map((t) => `${t.row},${t.col}`));

  // Temporarily merge new tiles into a virtual board
  const virtualBoard = board.map((row) =>
    row.map((cell) => ({ ...cell }))
  );
  for (const pt of placedTiles) {
    virtualBoard[pt.row][pt.col] = {
      ...virtualBoard[pt.row][pt.col],
      tile: { id: pt.id, letter: pt.letter, value: pt.value, isBlank: pt.isBlank },
    };
  }

  const words: ScoredWord[] = [];

  // Get words formed by placed tiles
  const rows = new Set(placedTiles.map((t) => t.row));
  const cols = new Set(placedTiles.map((t) => t.col));

  const isHorizontal = rows.size === 1;
  const isVertical = cols.size === 1;

  if (isHorizontal || (!isVertical && placedTiles.length === 1)) {
    const mainWord = extractHorizontalWord(virtualBoard, placedTiles[0].row, placedTiles[0].col, newTileSet);
    if (mainWord && mainWord.word.length > 1) words.push(mainWord);

    // Check vertical cross-words for each placed tile
    for (const pt of placedTiles) {
      const cross = extractVerticalWord(virtualBoard, pt.row, pt.col, newTileSet);
      if (cross && cross.word.length > 1) words.push(cross);
    }
  }

  if (isVertical) {
    const mainWord = extractVerticalWord(virtualBoard, placedTiles[0].row, placedTiles[0].col, newTileSet);
    if (mainWord && mainWord.word.length > 1) words.push(mainWord);

    for (const pt of placedTiles) {
      const cross = extractHorizontalWord(virtualBoard, pt.row, pt.col, newTileSet);
      if (cross && cross.word.length > 1) words.push(cross);
    }
  }

  // Bingo bonus: using all 7 tiles
  const bingoBonus = placedTiles.length === 7 ? 35 : 0;

  const total = words.reduce((sum, w) => sum + w.score, 0) + bingoBonus;

  return { total, words };
}

function extractHorizontalWord(
  board: Board,
  row: number,
  col: number,
  newTileSet: Set<string>
): ScoredWord | null {
  // Find leftmost col of this word
  let startCol = col;
  while (startCol > 0 && board[row][startCol - 1].tile !== null) startCol--;

  let word = '';
  let score = 0;
  let wordMultiplier = 1;
  let c = startCol;

  while (c < BOARD_SIZE && board[row][c].tile !== null) {
    const cell = board[row][c];
    const tile = cell.tile!;
    let letterVal = tile.value;

    if (newTileSet.has(`${row},${c}`)) {
      if (cell.bonus === 'DL') letterVal *= 2;
      if (cell.bonus === 'TL') letterVal *= 3;
      if (cell.bonus === 'DW' || cell.bonus === 'START') wordMultiplier *= 2;
      if (cell.bonus === 'TW') wordMultiplier *= 3;
    }

    word += tile.letter || '?';
    score += letterVal;
    c++;
  }

  if (word.length <= 1) return null;
  return { word, score: score * wordMultiplier };
}

function extractVerticalWord(
  board: Board,
  row: number,
  col: number,
  newTileSet: Set<string>
): ScoredWord | null {
  let startRow = row;
  while (startRow > 0 && board[startRow - 1][col].tile !== null) startRow--;

  let word = '';
  let score = 0;
  let wordMultiplier = 1;
  let r = startRow;

  while (r < BOARD_SIZE && board[r][col].tile !== null) {
    const cell = board[r][col];
    const tile = cell.tile!;
    let letterVal = tile.value;

    if (newTileSet.has(`${r},${col}`)) {
      if (cell.bonus === 'DL') letterVal *= 2;
      if (cell.bonus === 'TL') letterVal *= 3;
      if (cell.bonus === 'DW' || cell.bonus === 'START') wordMultiplier *= 2;
      if (cell.bonus === 'TW') wordMultiplier *= 3;
    }

    word += tile.letter || '?';
    score += letterVal;
    r++;
  }

  if (word.length <= 1) return null;
  return { word, score: score * wordMultiplier };
}

export function getFormedWords(board: Board, placedTiles: PlacedTile[]): string[] {
  const { words } = scoreMove(board, placedTiles);
  return words.map((w) => w.word.toUpperCase());
}
