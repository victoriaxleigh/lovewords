// Post-processes the Expo web build (dist/index.html) to add the PWA / iOS
// Home Screen tags that Expo's generated HTML template doesn't include:
//   - apple-touch-icon (Home Screen icon)
//   - web manifest link (installable PWA, needed for the app badge)
//   - apple-mobile-web-app meta (standalone display + app title)
//
// Idempotent: safe to run repeatedly. Runs as part of `npm run build:web`.

const fs = require('fs');
const path = require('path');

const INDEX = path.resolve(__dirname, '..', 'dist', 'index.html');

const TAGS = `
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.json" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="LoveWords" />
    <meta name="theme-color" content="#E91E8C" />`;

function main() {
  if (!fs.existsSync(INDEX)) {
    console.error(`Missing ${INDEX} — run \`expo export --platform web\` first.`);
    process.exit(1);
  }
  let html = fs.readFileSync(INDEX, 'utf8');

  if (html.includes('rel="manifest"')) {
    console.log('inject-web-meta: tags already present, skipping.');
    return;
  }
  if (!html.includes('</head>')) {
    console.error('inject-web-meta: no </head> found in dist/index.html.');
    process.exit(1);
  }

  html = html.replace('</head>', `${TAGS}\n  </head>`);
  fs.writeFileSync(INDEX, html);
  console.log('inject-web-meta: added PWA / iOS Home Screen tags to dist/index.html.');
}

main();
