/**
 * Optional NASPA Word List (NWL) lookup for word requests.
 *
 * NWL is licensed, so it is not in the repo by default. When a licensed copy is
 * added as `nwl.txt.gz` next to this file (one word per line, gzipped), the
 * review list shows whether each requested word is in it. Without the file
 * every word reports `not_checked`; nothing else depends on it.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NWL_PATH = path.join(__dirname, 'nwl.txt.gz');

let words; // undefined = not loaded yet, null = no file

function loadNwl(filePath = NWL_PATH) {
  if (words !== undefined) return words;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    words = new Set(
      raw
        .split('\n')
        .map((line) => line.trim().toUpperCase())
        .filter((line) => /^[A-Z]{2,15}$/.test(line))
    );
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('nwl load failed:', error.message);
    words = null;
  }
  return words;
}

/** 'in_nwl' | 'not_in_nwl' | 'not_checked' (no licensed list installed). */
function nwlStatus(word) {
  const list = loadNwl();
  if (!list) return 'not_checked';
  return list.has(String(word).toUpperCase()) ? 'in_nwl' : 'not_in_nwl';
}

function resetNwlForTests() {
  words = undefined;
}

module.exports = { loadNwl, nwlStatus, resetNwlForTests };
