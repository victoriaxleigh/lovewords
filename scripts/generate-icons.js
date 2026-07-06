// Rasterizes assets/logo/icon.svg into the PNG sizes the web app needs.
// Outputs into public/ so `expo export` copies them to the site root (dist/).
// Run: node scripts/generate-icons.js  (also runs as part of `npm run build:web`)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SVG = path.join(ROOT, 'assets', 'logo', 'icon.svg');
const PUBLIC = path.join(ROOT, 'public');
const ASSETS = path.join(ROOT, 'assets');

// [filename, size, destination dir]
const TARGETS = [
  ['apple-touch-icon.png', 180, PUBLIC], // iOS Home Screen icon
  ['icon-192.png', 192, PUBLIC], // PWA manifest
  ['icon-512.png', 512, PUBLIC], // PWA manifest
  ['icon-512-maskable.png', 512, PUBLIC], // PWA maskable (same art, full-bleed)
  ['favicon-32.png', 32, PUBLIC], // browser tab
  // Keep Expo's native/build assets in sync with the new logo too:
  ['icon.png', 1024, ASSETS],
  ['adaptive-icon.png', 1024, ASSETS],
];

async function main() {
  if (!fs.existsSync(SVG)) {
    console.error(`Missing source SVG: ${SVG}`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SVG);

  for (const [name, size, dir] of TARGETS) {
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, name);
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'cover' })
      .png()
      .toFile(out);
    console.log(`✓ ${path.relative(ROOT, out)} (${size}×${size})`);
  }
  console.log('Icons generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
