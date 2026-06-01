# LoveWords 💌

A Words with Friends-style word game built for two — play async, send love notes, and talk smack.

## Tech Stack

- **Frontend:** Expo ~54 / React Native 0.81 (web target only)
- **Backend:** Supabase (Postgres, Realtime, Auth)
- **Hosting:** Netlify (static site + serverless functions)
- **Push notifications:** Web Push API with VAPID keys via Netlify function

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

```bash
npm install
```

### Environment variables

Create a `.env.local` file in the project root (never committed):

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

These are only needed to run the Netlify functions locally. Ask Victoria for the values.

### Run the dev server

```bash
npx expo start --web
```

### Run tests

```bash
npx jest
```

## Deployment

Deployments are manual — run these commands from your terminal:

```bash
npx expo export --platform web
netlify deploy --prod --dir=dist --no-build
```

Requires `netlify login` first. Ask Victoria for Netlify access.

## Project Structure

```
src/
├── screens/       — GameScreen, LobbyScreen, AuthScreen, LoveNotesModal
├── components/    — BoardComponent, TileRack, TileComponent, ScoreBoard
├── engine/        — board, scoring, tiles, dictionary logic
├── supabase/      — Supabase client + all DB operations
├── hooks/         — useAuth
├── types/         — shared TypeScript types
└── utils/         — colors, push notifications

netlify/functions/ — notify.js (serverless Web Push sender)
public/sw.js       — service worker for background push notifications
__tests__/         — unit tests (board, scoring, tiles, swap, dictionary)
```

## Architecture Notes

- **Solo mode:** both players share the same UID; active side tracks by `moves.length % 2`
- **Realtime:** Supabase Realtime subscriptions; always does a fresh `SELECT *` on update events (not `payload.new`) to guarantee all columns are present
- **Drag + tap:** tiles can be placed by dragging or tapping (tap to select, tap cell to place)
- **Dictionary:** ENABLE word list (~178k words) fetched from GitHub CDN on first load, cached in `localStorage`
- See `AGENT_HANDOFF.md` for full architecture details
