/**
 * Scrabble dictionary using the ENABLE word list (public domain, ~173k words).
 * WWF and modern Scrabble dictionaries built on ENABLE but added words after it
 * froze in 1997 — those we care about live in wordSupplement.json.
 *
 * On first use it fetches the list from a public CDN and
 * caches it in localStorage so every lookup after that is instant.
 */

// Words that are valid in modern Scrabble (NWL) / Words With Friends but
// missing from 1997-era ENABLE. Shared with the server-side solver dictionary
// (netlify/functions/lib/dictionary.js) so the two cannot drift.
import SUPPLEMENT from './wordSupplement.json';

// Only the raw fetched ENABLE list is cached (see below); SUPPLEMENT is merged
// at read time on both the cache and the fetch path, so changing the supplement
// needs no cache bump. Bump this only if the cached payload's SHAPE changes —
// a needless bump makes every phone discard a valid list and re-download ~1.7MB,
// and isValidWord fails OPEN if that download fails.
const CACHE_KEY = 'lovewords_dict_v2';
const WORD_LIST_URL =
  'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';

let wordSet: Set<string> | null = null;
let loadPromise: Promise<Set<string>> | null = null;

async function loadDictionary(): Promise<Set<string>> {
  if (wordSet) return wordSet;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Try localStorage cache first
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        wordSet = new Set([...JSON.parse(cached), ...SUPPLEMENT]);
        return wordSet;
      }
    } catch {}

    // Fetch from CDN
    const res = await fetch(WORD_LIST_URL);
    const text = await res.text();
    const words = text
      .split('\n')
      .map((w) => w.trim().toUpperCase())
      .filter(Boolean);

    wordSet = new Set([...words, ...SUPPLEMENT]);

    // Cache it
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(words));
    } catch {}

    return wordSet;
  })();

  return loadPromise;
}

// Kick off loading as soon as this module is imported (browser only)
if (typeof window !== 'undefined') {
  loadDictionary().catch(() => {});
}

export async function isValidWord(word: string): Promise<boolean> {
  const upper = word.toUpperCase().trim();
  if (upper.length < 2) return false;

  try {
    const dict = await loadDictionary();
    return dict.has(upper);
  } catch {
    // If dictionary fails to load, be generous
    return true;
  }
}

export async function validateWords(
  words: string[]
): Promise<{ valid: boolean; invalidWords: string[] }> {
  const results = await Promise.all(
    words.map(async (w) => ({ word: w, valid: await isValidWord(w) }))
  );
  const invalidWords = results.filter((r) => !r.valid).map((r) => r.word);
  return { valid: invalidWords.length === 0, invalidWords };
}

export function isDictionaryLoaded(): boolean {
  return wordSet !== null;
}
