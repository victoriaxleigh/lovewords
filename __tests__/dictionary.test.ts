/**
 * Dictionary tests
 * We mock fetch to return a controlled word list so tests are fast and offline.
 */

const MOCK_WORDS = [
  'cat', 'dog', 'bird', 'play', 'word', 'lovely', 'star',
  'quiz', 'zap', 'xi', 'qi', 'za', 'aa', 'ab', 'at', 'it',
].join('\n');

// Mock fetch before importing the module
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    text: () => Promise.resolve(MOCK_WORDS),
  })
) as jest.Mock;

// Mock localStorage
const store: Record<string, string> = {};
Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    clear: () => Object.keys(store).forEach((k) => delete store[k]),
    removeItem: (key: string) => { delete store[key]; },
  },
  writable: true,
});

// Import AFTER mocks are set up
import { isValidWord, validateWords } from '../src/engine/dictionary';

describe('isValidWord', () => {
  test('accepts valid Scrabble words', async () => {
    expect(await isValidWord('cat')).toBe(true);
    expect(await isValidWord('dog')).toBe(true);
    expect(await isValidWord('play')).toBe(true);
  });

  test('is case-insensitive', async () => {
    expect(await isValidWord('CAT')).toBe(true);
    expect(await isValidWord('Cat')).toBe(true);
    expect(await isValidWord('cat')).toBe(true);
  });

  test('rejects words not in dictionary', async () => {
    expect(await isValidWord('zzzzz')).toBe(false);
    expect(await isValidWord('xyzzy')).toBe(false);
  });

  test('rejects single letter words', async () => {
    expect(await isValidWord('a')).toBe(false);
    expect(await isValidWord('z')).toBe(false);
  });

  test('accepts common 2-letter Scrabble words', async () => {
    expect(await isValidWord('qi')).toBe(true);
    expect(await isValidWord('za')).toBe(true);
    expect(await isValidWord('aa')).toBe(true);
    expect(await isValidWord('xi')).toBe(true);
  });
});

describe('validateWords', () => {
  test('returns valid=true when all words are valid', async () => {
    const result = await validateWords(['cat', 'dog']);
    expect(result.valid).toBe(true);
    expect(result.invalidWords).toHaveLength(0);
  });

  test('returns valid=false when any word is invalid', async () => {
    const result = await validateWords(['cat', 'zzzzz']);
    expect(result.valid).toBe(false);
    expect(result.invalidWords).toContain('zzzzz');
  });

  test('returns all invalid words in the list', async () => {
    const result = await validateWords(['cat', 'zzzzz', 'qqqq']);
    expect(result.invalidWords).toHaveLength(2);
    expect(result.invalidWords).toContain('zzzzz');
    expect(result.invalidWords).toContain('qqqq');
  });

  test('handles empty word list', async () => {
    const result = await validateWords([]);
    expect(result.valid).toBe(true);
    expect(result.invalidWords).toHaveLength(0);
  });

  test('handles single valid word', async () => {
    const result = await validateWords(['cat']);
    expect(result.valid).toBe(true);
  });

  test('handles single invalid word', async () => {
    const result = await validateWords(['zzzzz']);
    expect(result.valid).toBe(false);
    expect(result.invalidWords).toEqual(['zzzzz']);
  });
});
