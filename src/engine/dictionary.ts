/**
 * Scrabble dictionary using the ENABLE word list (public domain, ~173k words).
 * WWF and modern Scrabble dictionaries built on ENABLE but added words after it
 * froze in 1997 — those we care about live in SUPPLEMENT below.
 *
 * On first use it fetches the list from a public CDN and
 * caches it in localStorage so every lookup after that is instant.
 */

// Bump the version when SUPPLEMENT changes so cached phones pick it up.
const CACHE_KEY = 'lovewords_dict_v2';
const WORD_LIST_URL =
  'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt';

// Words that are valid in modern Scrabble (NWL) / Words With Friends but
// missing from 1997-era ENABLE. Plurals need their own entries.
const SUPPLEMENT = [
  // Two-letter staples — QI/ZA are the classic Q- and Z-dumps
  'QI', 'ZA', 'KI', 'GI', 'FE', 'OI', 'OK', 'EW', 'TE', 'DA', 'PO',
  'QIS', 'ZAS', 'KIS', 'GIS', 'FES', 'OKS',
  // Modern additions to the official lists
  'ZEN', 'GIF', 'GIFS', 'VAX', 'VAXES',
  'EMOJI', 'EMOJIS', 'SELFIE', 'SELFIES', 'MEME', 'MEMES',
  'VAPE', 'VAPES', 'VAPED', 'VAPING',
  'BLOG', 'BLOGS', 'VLOG', 'VLOGS', 'BAE', 'BAES', 'FOMO',
  'YEET', 'YEETS', 'YEETED', 'YEETING',
  'HANGRY', 'HANGRIER', 'HANGRIEST', 'ADORBS',
  // House words — anything we decide counts, goes here 💕
];

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
