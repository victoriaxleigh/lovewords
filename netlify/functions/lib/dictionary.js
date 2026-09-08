const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The client fetches ENABLE from a CDN and caches it in localStorage. A Netlify
// function cannot afford an external fetch per cold start, so the list is
// vendored next to this file and gunzipped once per container.
const WORD_LIST_PATH = path.join(__dirname, 'enable1.txt.gz');
const SUPPLEMENT = require('../../../src/engine/wordSupplement.json');

// Trie nodes are plain objects: child letters plus a terminal marker. The
// generator prunes on the first dead prefix, which a flat Set could not do —
// it would force every rack permutation to be enumerated instead.
const TERMINAL = '$';

let trie = null;
let wordCount = 0;

function insert(root, word) {
  let node = root;
  for (const letter of word) {
    let next = node[letter];
    if (!next) {
      next = {};
      node[letter] = next;
    }
    node = next;
  }
  node[TERMINAL] = true;
}

function buildTrie() {
  const raw = zlib.gunzipSync(fs.readFileSync(WORD_LIST_PATH)).toString('utf8');
  const root = {};
  let count = 0;
  for (const line of raw.split('\n')) {
    const word = line.trim().toUpperCase();
    // ENABLE is all lowercase a-z, but guard anyway so a stray line can't
    // introduce a non-letter edge the generator would never reach.
    if (word.length < 2 || !/^[A-Z]+$/.test(word)) continue;
    insert(root, word);
    count++;
  }
  for (const word of SUPPLEMENT) {
    const upper = String(word).toUpperCase();
    if (upper.length < 2 || !/^[A-Z]+$/.test(upper)) continue;
    insert(root, upper);
    count++;
  }
  wordCount = count;
  return root;
}

// Module scope, so warm invocations reuse the trie built by the cold start.
function getTrie() {
  if (!trie) trie = buildTrie();
  return trie;
}

function getWordCount() {
  getTrie();
  return wordCount;
}

function isValidWord(word) {
  if (typeof word !== 'string' || word.length < 2) return false;
  let node = getTrie();
  for (const letter of word.toUpperCase()) {
    node = node[letter];
    if (!node) return false;
  }
  return node[TERMINAL] === true;
}

module.exports = { TERMINAL, getTrie, getWordCount, isValidWord };
