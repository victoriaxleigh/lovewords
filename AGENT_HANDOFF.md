# LoveWords — Agent Handoff Document

> Last updated: 2026-07-06 (Session 7)

## What This App Is
**LoveWords** is a Words with Friends clone built as a web app for a couple to play async online.
- Built with **Expo ~54 / React Native 0.81 / React 19** (web target only)
- Deployed on **Netlify** (URL managed by user)
- Backend: **Supabase** (Postgres, Realtime, Auth)
- Push notifications: **Web Push API** with VAPID keys + Netlify serverless function (`web-push` npm package)
- Dictionary: ENABLE word list (~178k words) fetched from GitHub CDN at runtime, cached in `localStorage`

---

## Package Versions (from package.json)
```json
"expo": "~54.0.33",
"react": "19.1.0",
"react-native": "0.81.5",
"react-native-web": "^0.21.0",
"@supabase/supabase-js": "^2.105.1",
"@react-navigation/native": "^7.2.2",
"@react-navigation/native-stack": "^7.14.12",
"react-native-gesture-handler": "^2.31.1",
"typescript": "~5.9.2",
"web-push": "^3.6.7"
```
Dev: `jest@^29.7.0`, `jest-expo@^55`, `ts-jest@^29.4.9`

---

## Project Structure

```
C:\Users\victo\lovewords\
├── App.tsx                          ← Root: auth gate, navigation, push registration
├── package.json
├── netlify.toml                     ← Build + SPA redirect config
├── AGENT_HANDOFF.md                 ← This file
├── RELEASE_NOTES.md                 ← Changelog by session
├── ISSUES.md                        ← Active bug tracker (update each session)
├── public/
│   └── sw.js                        ← Service worker (background push, notificationclick)
├── netlify/
│   └── functions/
│       └── notify.js                ← Serverless: receives POST, sends Web Push
└── src/
    ├── screens/
    │   ├── AuthScreen.tsx           ← Login / Register form
    │   ├── LobbyScreen.tsx          ← Game list, invite partner, solo button, delete game
    │   ├── GameScreen.tsx           ← Main game (~820 lines, the core)
    │   └── LoveNotesModal.tsx       ← In-game chat/love notes
    ├── components/
    │   ├── BoardComponent.tsx       ← 15×15 board, exports CELL_SIZE
    │   ├── TileRack.tsx             ← Drag rack with PanResponder (drag + tap-to-select)
    │   ├── TileComponent.tsx        ← Single tile (selected state, blank, isNew, highlight)
    │   └── ScoreBoard.tsx           ← Score + bag count header
    ├── engine/
    │   ├── board.ts                 ← createEmptyBoard, isValidPlacement, applyMoveToBoard, BOARD_SIZE=15
    │   ├── scoring.ts               ← scoreMove, getFormedWords (WWF bonus rules)
    │   ├── tiles.ts                 ← createTileBag, drawTiles, shuffle, exchangeTiles
    │   └── dictionary.ts            ← validateWords (async, ENABLE list, localStorage cache)
    ├── supabase/
    │   ├── config.ts                ← Supabase client (URL + anon key hardcoded here)
    │   ├── authService.ts           ← register, login, logout, onAuthChange, getUserByEmail
    │   └── gameService.ts           ← All game DB operations (see full breakdown below)
    ├── hooks/
    │   └── useAuth.ts               ← Wraps onAuthChange in useState/useEffect
    ├── types/
    │   └── index.ts                 ← All shared TypeScript types
    └── utils/
        ├── colors.ts                ← Color palette (light pink/rose theme)
        ├── webNotifications.ts      ← requestNotificationPermission, sendTurnNotification, sendLoveNoteNotification
        └── pushSubscription.ts      ← SW registration + Supabase push_subscriptions upsert
```

---

## Credentials & Config

### Supabase (hardcoded in `src/supabase/config.ts`)
The Supabase URL and anon key are committed to `src/supabase/config.ts`. These
are intentionally public — the anon key only grants what RLS policies allow,
and the URL must be embedded in the client. Netlify's secrets scanner will
flag them on deploy unless they're listed in `SECRETS_SCAN_OMIT_KEYS` (see
`netlify.toml`).

### VAPID Keys
- **Public key** is hardcoded in `src/utils/pushSubscription.ts`. It's public
  by design (subscribe-side of the Web Push keypair) and must be in the
  client bundle.
- **Private key** lives only in the Netlify env var `VAPID_PRIVATE_KEY` (used
  by `netlify/functions/notify.js`). **Never commit this value.** If it ever
  appears in a commit, rotate the keypair (`web-push generate-vapid-keys`),
  update the public key in `pushSubscription.ts`, and update both VAPID env
  vars in Netlify.

### Netlify Environment Variables (for `notify.js` serverless function)
```
VAPID_PUBLIC_KEY=<public key — same value as in pushSubscription.ts>
VAPID_PRIVATE_KEY=<private key — REDACTED, see Netlify env settings>
VAPID_EMAIL=<any email, identifies sender to push services>
SUPABASE_URL=<same as src/supabase/config.ts>
SUPABASE_SERVICE_KEY=<service role key, NOT anon key — has full DB access>
```

### Local `.env` (only needed for running Netlify functions locally)
```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

---

## Deployment

```bash
cd C:\Users\victo\lovewords
npm run build:web                             # icons + expo export + inject PWA meta → dist/
netlify deploy --prod --dir=dist --no-build   # deploy
```

**⚠️ Use `npm run build:web`, NOT a bare `npx expo export`.** The bare export does
NOT add the iOS Home Screen / PWA tags. `build:web` runs three steps in order:
1. `scripts/generate-icons.js` — rasterizes `assets/logo/icon.svg` → PNGs in `public/`
2. `expo export --platform web` — copies `public/*` into `dist/` root
3. `scripts/inject-web-meta.js` — injects apple-touch-icon / manifest / apple-mobile-web-app
   meta into `dist/index.html` (Expo's generated template omits these). Idempotent.

**Pitfalls:**
- `--no-build` is required — without it, Netlify CLI tries to install extensions and 403s
- Rate limit (429 Too Many Requests): wait 10-15 min between deploys
- Netlify CLI requires `netlify login` first; the auth token is NOT available in the agent environment — user must run from their own terminal
- The `netlify.toml` sets `ignore = "exit 1"` so Netlify's own CI never auto-builds; deploy is always manual

```toml
# netlify.toml
[build]
  command = "npx expo export --platform web"
  publish = "dist"
  ignore = "exit 1"
[functions]
  directory = "netlify/functions"
  node_bundler = "nft"        # nft required — esbuild can't bundle web-push
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## Supabase Tables

### `profiles`
Created on register, used by `getUserByEmail` for invites.
| Column | Type |
|---|---|
| `id` | uuid (= auth.users id) |
| `email` | text |
| `display_name` | text |

### `games`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `player1_uid` | uuid | FK → auth.users |
| `player2_uid` | uuid | FK → auth.users |
| `players` | jsonb | `[Player, Player]` array including rack, score |
| `board` | jsonb | 15×15 `Cell[][]` |
| `bag` | jsonb | Remaining `Tile[]` |
| `current_turn` | **uuid** | UID of active player |
| `status` | text | `'waiting'` \| `'active'` \| `'finished'` |
| `moves` | jsonb | `Move[]` array |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**⚠️ CRITICAL: `current_turn` is a `uuid` column.** Writing a non-UUID string causes `invalid input syntax for type uuid`. Solo functions (`submitSoloMove`, `passSoloTurn`, `swapSoloTiles`) intentionally never write `current_turn`.

**RLS policies needed** (run once in Supabase SQL Editor):
```sql
-- Delete policy (required for in-app game deletion):
CREATE POLICY "Players can delete their games"
ON games FOR DELETE
USING (player1_uid = auth.uid() OR player2_uid = auth.uid());
```

### `love_notes`
| Column | Type |
|---|---|
| `id` | uuid PK |
| `game_id` | uuid |
| `from_uid` | uuid |
| `to_uid` | uuid |
| `message` | text |
| `emoji` | text |
| `read` | bool |
| `created_at` | timestamptz |

### `push_subscriptions`
Upserted on conflict of `user_id` (one row per user).
| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | conflict target for upsert |
| `endpoint` | text | push service URL |
| `p256dh` | text | encryption key |
| `auth` | text | auth secret |

---

## TypeScript Types (`src/types/index.ts`)

```ts
type Player = {
  uid: string;
  displayName: string;
  email: string;   // ← 'solo' for solo player 2, real email otherwise
  score: number;
  rack: Tile[];
};

type Tile = { id: string; letter: string; value: number; isBlank?: boolean };
type PlacedTile = Tile & { row: number; col: number; isNew?: boolean };

type CellBonus = 'TW' | 'DW' | 'TL' | 'DL' | 'START' | null;
type Cell = { row: number; col: number; tile: Tile | null; bonus: CellBonus };
type Board = Cell[][];

type GameStatus = 'waiting' | 'active' | 'finished';

type Move = {
  uid: string;        // player uid, 'pass', or 'swap'
  tiles: PlacedTile[];
  score: number;
  timestamp: number;
  word?: string;
};

type LoveNote = {
  id: string; fromUid: string; toUid: string;
  message: string; emoji: string; timestamp: number; read: boolean;
};

type Game = {
  id: string;
  players: [Player, Player];
  board: Board;
  bag: Tile[];
  currentTurn: string;  // uid
  status: GameStatus;
  moves: Move[];
  createdAt: number;
  updatedAt: number;
  loveNotes?: LoveNote[];
};
```

---

## Colors (`src/utils/colors.ts`)
This is a **light pink/rose theme** (NOT dark):
```ts
primary: '#E91E8C'       // bright magenta/rose
primaryLight: '#FF6EB4'
primaryDark: '#B5006E'
accent: '#FF4081'
background: '#FFF0F5'    // very light pink
surface: '#FFFFFF'
text: '#2D0A1E'          // near-black
textLight: '#8C4D6A'
border: '#F0A8C8'
boardBg: '#1A0A12'       // dark board background
emptyCell: '#2D1420'
tileDefault: '#FFFFFF'
tileText: '#2D0A1E'
tileSelected: '#FF6EB4'
tilePlaced: '#FFD6EC'
tw: '#C62828'   dw: '#E91E8C'   tl: '#1565C0'   dl: '#64B5F6'   start: '#AD1457'
success: '#4CAF50'   error: '#F44336'   warning: '#FF9800'
```

---

## gameService.ts — Full Function Reference

### Regular multiplayer functions
| Function | Description |
|---|---|
| `createGame(p1, p2)` | Creates game, draws 7 tiles each, sets current_turn = p1.uid |
| `subscribeToGame(id, cb)` | Fetches initial state + Supabase Realtime UPDATE subscription. On each RT event, does a fresh `SELECT *` (not `payload.new`) — Supabase only includes changed columns in `payload.new`, so swap/pass updates omit `board`, which would crash `BoardComponent`. |
| `subscribeToUserGames(uid, cb)` | All games where player1_uid or player2_uid = uid, ordered by updated_at desc |
| `submitMove(gameId, game, playerUid, placedTiles)` | Validates turn, scores, updates board/rack/bag/current_turn, sends push notification |
| `passTurn(gameId, game, playerUid)` | Flips current_turn to other player |
| `swapTiles(gameId, game, playerUid, tileIds)` | Returns tiles to shuffled bag, draws new ones, flips turn |
| `sendLoveNote(gameId, fromUid, toUid, message, emoji, senderName)` | Inserts note row, sends push notification |
| `subscribeToLoveNotes(gameId, cb)` | Fetches notes ordered by created_at desc + INSERT subscription |
| `markNoteRead(noteId)` | Sets read = true |
| `deleteGame(gameId)` | Deletes game row; requires RLS delete policy on games table |

### Solo-only functions (NEVER touch current_turn)
| Function | Description |
|---|---|
| `createSoloGame(player)` | Both players uid = player.uid; player2 email = 'solo'; current_turn = player.uid forever |
| `submitSoloMove(gameId, game, playerIndex, placedTiles)` | Updates board/rack/score for the given index; omits current_turn from update |
| `passSoloTurn(gameId, game)` | Appends pass move to moves array; no current_turn change |
| `swapSoloTiles(gameId, game, playerIndex, tileIds)` | Swaps tiles for given player index; no current_turn change |

---

## Solo Mode — Architecture (CRITICAL)

Solo mode lets a user practice by playing both sides of the board.

### How Solo Works
1. **Detection**: `game.players.some(p => p.email === 'solo')` — player 2's email is set to the literal string `'solo'`
2. **Both players share the same uid**: `players[0].uid = players[1].uid = myUid`
3. **`current_turn` stays as `myUid` forever** — it is never updated
4. **Active side** = `game.moves.length % 2`: even index = Player 1, odd = Player 2
5. **All mutations** use `submitSoloMove` / `passSoloTurn` / `swapSoloTiles` which omit `current_turn` from their Supabase updates

### GameScreen solo-specific logic
```ts
const isSolo = game?.players.some((p) => p.email === 'solo') ?? false;
// currentSide is a STABLE index — always findIndex for multiplayer, never turn-based flip.
// Using currentTurn === myUid ? 0 : 1 was a bug: it swapped me/partner on the opponent's turn,
// causing self-notifications and the wrong rack being shown to player 2.
const currentSide = isSolo
  ? ((game?.moves.length ?? 0) % 2)   // 0 = P1, 1 = P2
  : (game?.players.findIndex((p) => p.uid === myUid) ?? 0);
const isMyTurn = isSolo || game?.currentTurn === myUid;  // always true in solo
const me = game?.players[currentSide];   // correct rack for each side
const partner = game?.players[1 - currentSide];
```

Turn flip detection in the Realtime subscription:
```ts
// prevMovesLengthRef starts at -1 (sentinel) to avoid spurious clear on first load
if (prevMovesLengthRef.current === -1) {
  prevMovesLengthRef.current = updatedGame.moves.length; // initialise, no clear
} else if (updatedGame.moves.length !== prevMovesLengthRef.current) {
  // A move committed — reset UI for next side's turn
  setPendingTiles([]); setSelectedTile(null); setSwapMode(false);
  setSwapSelectedIds([]); setShowPassConfirm(false); setSubmitError(null);
  if (soloWaitingRealtimeRef.current) {
    setSubmitting(false);       // unlock UI once RT rack update arrives
    soloWaitingRealtimeRef.current = false;
  }
  prevMovesLengthRef.current = updatedGame.moves.length;
}
```

UI lock after solo submit:
```ts
// handleSubmit — solo success path keeps submitting=true until RT update
if (isSolo) {
  holdForRealtime = true;
  soloWaitingRealtimeRef.current = true;
}
// finally block: if (!holdForRealtime) setSubmitting(false);
```

---

## Drag-and-Drop Architecture

- **Both drag and tap work for placing tiles.** Drag is the primary interaction on mobile; tap-to-select is the fallback for web mouse users.
- **`TileRack.tsx`** contains a `DraggableTile` inner component per tile, each with its own `PanResponder`
- **`BoardComponent.tsx`** contains a `DraggablePendingTile` inner component — same pattern — for tiles already placed on the board. This allows dragging a placed tile to a new cell without recalling it first.
- **Tap vs drag threshold**: 8px (`Math.sqrt(dx² + dy²) < 8` = tap, else = drag) — applies to both rack and board tiles
  - Rack tap in normal mode: selects/deselects the tile (`setSelectedTile`). Rack tap in swap mode: swap action.
  - Board tile tap (< 8px): returns tile to rack (`handlePendingTilePress`)
  - Board tile drag (≥ 8px): pulls tile off its cell, starts floating animation (`handleBoardTileDragStart`)
- **Web click-to-place flow**: tap a rack tile to select it → tap an open board cell to place it (via `handleCellPress`, which already handled the `selectedTile` path). Tap a placed tile to return it to rack.
- `onDragStart` → `handleDragStart` (rack) or `handleBoardTileDragStart` (board) in GameScreen
  - `handleBoardTileDragStart`: calls `setPendingTiles(prev => prev.filter(t => t.id !== tile.id))` to clear the cell, then starts the floating animation. Same measure + dragXY logic as rack drag.
- `onDragMove` → updates `Animated.ValueXY` (`dragXY`) to follow finger, offset by -25px to center on fingertip
- `onDragEnd` → `handleDragEnd`: uses **functional updater** `setPendingTiles(prev => ...)` to avoid stale closure checking occupied cells. Board and rack drags share the same handler.
- If dropped off-board or onto an occupied cell, the tile simply returns to the rack (it's not in `pendingTiles`, so the rack filter shows it again automatically)
- Floating tile: `Animated.View` with `StyleSheet.absoluteFillObject` + `zIndex: 999`, `pointerEvents="none"`, placed **outside** the `ScrollView` in `GameScreen` so it stays screen-fixed during scroll
- `CELL_SIZE = Math.floor((Dimensions.get('window').width - 8) / BOARD_SIZE)` — exported from `BoardComponent.tsx`
- Tile in rack fades to `opacity: 0.3` while being dragged (`draggingTileId` prop)
- In swap mode: `dragCallbacks` is set to `undefined` on the rack AND `boardTileDragCallbacks` is `undefined` on the board (drag disabled while swapping)
- **⚠️ Stale closure fix:** `PanResponder` is created once with `useRef`. `onTilePress`, `disabled`, and `dragCallbacks` are kept in refs updated via `useEffect`. Always use `xyzRef.current` inside the PanResponder handlers — never the raw prop — or callbacks will be stale after re-renders.
- **Web scrolling**: `GameScreen` wraps content in a `ScrollView` (header → action buttons). `boardRef.current?.measure()` is called fresh on each drag start, returning current page coordinates that account for scroll offset — drop targets stay accurate after scrolling.

---

## Swap Tiles — Current Behaviour

Swap is a **single-tile immediate** operation:
1. User taps "Swap" → enters swap mode
2. Hint shows: "Tap a tile to discard it and draw a replacement"
3. User taps **one tile** → `handleSwapTileToggle(tileId)` immediately calls `swapSoloTiles` / `swapTiles` with `[tileId]`
4. Swap mode exits automatically after the swap completes (see locking behaviour below)
5. If bag is empty, an inline error is shown and swap mode exits

There is no multi-select or confirm step.

### Solo swap — immediate local state update (Session 4)

`swapSoloTiles` returns `{ success: true, updatedGame: Game }` on success. After the DB write succeeds, `handleSwapTileToggle` calls `setGame(result.updatedGame)` immediately in the try block. The `finally` block unconditionally clears `swapping`, `swapMode`, and `swapSelectedIds`. The UI never stays locked.

The Realtime update arrives later and calls `setGame(updatedGame)` via the subscription callback — this is a harmless re-sync since the data is identical to what was already applied locally.

**⚠️ Do NOT re-introduce a `holdForRealtime` / `soloWaitingRealtimeRef` lock for the swap path.** A previous attempt (Session 3) did this to prevent a stale-rack flash, but it caused a worse regression: if Realtime was delayed, `swapping=true` stayed set indefinitely and the Cancel button (disabled during `swapping`) gave the user no escape. The immediate local update is the correct pattern.

`soloWaitingRealtimeRef` is still used by the **submit** path only (`handleSubmit`) — that lock is safe because the Submit button is also the only action during submit, and the lock has a natural exit when moves.length changes.

Multiplayer swap clears state immediately in `finally` (unchanged).

---

## Submit Error Handling

`Alert.alert` is **not used** anywhere in GameScreen or LobbyScreen. AuthScreen still uses it (known issue).

### Inline banners
- `submitError` state → red banner with ✕ dismiss button above action buttons
- `submitSuccess` state → green banner that auto-dismisses after 3 seconds
- Error clears automatically when: recalled or new tile placed

### Submit validation order
1. `isValidPlacement(board, pendingTiles, isFirstMove)` — tiles in a line; first move must cover center (7,7)
2. `getFormedWords(board, pendingTiles).length > 0` — must form at least one word
3. `validateWords(words)` — async dictionary check (wrapped in try/catch; on error, words are allowed generously)
4. `submitSoloMove` or `submitMove` — DB update (wrapped in try/catch)

---

## Push Notifications Architecture

### Full flow
1. **`App.tsx`**: After login, waits 2 seconds then calls `registerPushSubscription(user.id)`
2. **`pushSubscription.ts`**: Registers `/sw.js` service worker → requests Notification permission → calls `pushManager.subscribe()` with VAPID public key → upserts `{user_id, endpoint, p256dh, auth}` to Supabase `push_subscriptions`
3. **`gameService.ts`**: After `submitMove` or `sendLoveNote` succeeds, calls `sendPushNotification(recipientUid, senderName, type)` which POSTs to `/.netlify/functions/notify`
4. **`netlify/functions/notify.js`**: Fetches recipient's push subscription from Supabase using service role key → calls `webpush.sendNotification()` → if 410 (expired), deletes the stale row
5. **`public/sw.js`**: Receives `push` event → calls `self.registration.showNotification()` → on `notificationclick`, focuses existing window or opens new one

### In-tab notifications
`webNotifications.ts` also has `sendTurnNotification` and `sendLoveNoteNotification` which use `new Notification(...)` directly (works when tab is open/focused, no service worker needed).

### Notes
- Fails silently everywhere — push errors never break game actions
- `node_bundler = "nft"` in `netlify.toml` is required for `web-push` to bundle correctly (esbuild fails)
- Push subscription is stored one-per-user (upsert on conflict `user_id`)

---

## App Icon & Home Screen Badge (iPhone)

Added Session 7 (2026-07-06). Makes LoveWords installable to the iPhone Home
Screen with a custom icon and a notification count badge on the tile.

### Logo
- **Source of truth:** `assets/logo/icon.svg` — a white WWF-style tile with a pink
  heart and an "8" point value, on a pink gradient (full-bleed so iOS can mask the
  corners). Edit this SVG, then re-run `npm run icons` to regenerate all PNGs.
- `scripts/generate-icons.js` (sharp) renders it into:
  - `public/apple-touch-icon.png` (180) — iOS Home Screen icon
  - `public/icon-192.png`, `public/icon-512.png`, `public/icon-512-maskable.png` — PWA manifest
  - `public/favicon-32.png` — browser tab
  - `assets/icon.png`, `assets/adaptive-icon.png` (1024) — kept in sync for native/EAS builds
- `public/manifest.json` — makes it an installable standalone PWA (name, theme, icons).
- iOS auto-detects `/apple-touch-icon.png` at the site root; the `<link>` + manifest
  + `apple-mobile-web-app-*` meta are injected into `dist/index.html` by
  `scripts/inject-web-meta.js` at build time (Expo's template omits them).

### Badge (the "1" on the icon)
Uses the **Badging API** (`navigator.setAppBadge` / `clearAppBadge`).

**Hard requirements — badge shows nothing otherwise:**
- App must be **Added to Home Screen** (installed PWA), NOT a Safari tab
- **iOS 16.4+**
- Notification permission granted (the existing push flow requests it)

**Model = "clear when I open the app":**
- **Increment:** `public/sw.js` push handler sets the badge to
  `getNotifications().length + 1` when a push arrives (works with the app closed).
- **Clear:** `src/utils/appBadge.ts` → `setupBadgeClearing()` (wired in `App.tsx`)
  calls `clearAppBadge()` + closes tray notifications on load and on focus/visibility.
- All calls are feature-guarded and best-effort — no-op on unsupported platforms,
  never throw, never break game actions.

**Testing note:** the badge can ONLY be verified on a real iPhone with the app
added to the Home Screen. It will never appear in desktop Safari or a normal
mobile Safari tab. Full flow to test: install to Home Screen → grant notifications
→ have the partner make a move while the app is closed → badge appears → open app → clears.

---

## Auth Flow

`useAuth.ts` → `onAuthChange(setUser)` → `user` is `undefined` while loading, `null` when logged out, Supabase User when logged in.

`App.tsx` reads `user.user_metadata.display_name` (set during registration) for the display name.

Registration (`authService.ts`):
1. `supabase.auth.signUp({ email, password, options: { data: { display_name } } })`
2. Also inserts row into `profiles` table: `{ id, email, display_name }`

`getUserByEmail` queries the `profiles` table (not auth.users directly) to find opponents for invites.

---

## Engine Reference

### `board.ts`
- `BOARD_SIZE = 15`
- `createEmptyBoard()` — builds 15×15 with WWF bonus square layout
- `isValidPlacement(board, tiles, isFirstMove)` — checks: same row OR col, no occupied cells, first move covers (7,7), subsequent moves adjacent to existing tile
- `applyMoveToBoard(board, tiles)` — returns new board with tiles committed
- `getCell(board, row, col)` — returns null if out of bounds

### `scoring.ts`
- `scoreMove(board, placedTiles)` → `{ total, words: [{word, score}] }` — applies DL/TL/DW/TW/START bonuses only for newly placed tiles; bingo bonus +35 for 7-tile play
- `getFormedWords(board, placedTiles)` → `string[]` — convenience wrapper

### `tiles.ts`
- `createTileBag()` — standard WWF distribution (104 tiles: 9×A, 13×E, 5×S, 7×T, 2 blanks, etc.), shuffled. Note: previously a Scrabble-count/WWF-value hybrid (100 tiles); switched to pure WWF for a less punishing rack.
- Tile IDs use `crypto.randomUUID()` — collision-proof across reloads and sessions. Native browser API, no polyfill needed.
- `drawTiles(bag, count)` → `{ drawn, remaining }` — takes from front of array
- `shuffle(arr)` — Fisher-Yates
- `exchangeTiles(rack, tilesToExchange, bag)` — exported but never called (swap logic is inlined in gameService)

### `dictionary.ts`
- `validateWords(words)` → `Promise<{ valid, invalidWords }>` — loads ENABLE list from GitHub CDN on first call, caches in localStorage under key `lovewords_dict_v1`
- `isDictionaryLoaded()` — synchronous check; GameScreen polls this every 500ms until true, then sets `dictReady = true`
- On load failure, all words return `true` (generous fallback)
- Dictionary URL: `https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt`

---

## LoveNotesModal Key Details

- `FlatList` with `inverted` prop for newest-at-bottom chat layout
- Quick note chips use a horizontal `FlatList` — **NOT ScrollView** (ScrollView steals tap events on web)
- `KeyboardAvoidingView` wraps the whole modal
- Inline error state for send failures (no `Alert.alert`)
- 17 pre-written punny quick notes (scrabble puns, e.g. "You're the Q to my U 💝", "You complete my rack 😍")
- Subscription uses Realtime INSERT filter on `game_id`

---

## Delete Game — How It Works

`gameService.ts` → `deleteGame(gameId)`: simple `supabase.from('games').delete().eq('id', gameId)`.

`LobbyScreen.tsx`: long-press (500ms) any game card → `deleteConfirmId` state set → inline confirm renders below card → tap Delete → `handleDeleteGame` → `deleteGame` → row removed from Supabase → Realtime subscription removes it from the list automatically.

**Requires** the Supabase RLS delete policy (see Supabase Tables section above).

---

## App Navigation Structure

```
Stack.Navigator (no header)
├── "Auth"  → AuthScreen         (shown when user === null)
└── "Lobby" → LobbyScreen        (shown when logged in)
    └── "Game" → GameScreen      (navigate with { gameId, myUid, myDisplayName })
        └── LoveNotesModal       (rendered inside GameScreen, visibility toggled)
```

---

## Smack Talk Feature

When it's the user's turn (normal games only, not solo) and they're losing by more than 10 points, a random smack talk message pops up in a Modal. 16 messages in the `SMACK_TALK` array in `GameScreen.tsx`. Dismissed by tapping anywhere or the "Okay okay 😤" button.

---

## Tests

65 unit tests cover the engine layer. Run with:
```bash
npx jest
```
Suites: `board`, `scoring`, `tiles`, `swap`, `dictionary`. All located in `__tests__/`. Always run after touching anything in `src/engine/` or `src/supabase/gameService.ts`.

Not re-run in Session 5. Session 5 touched `gameService.ts` (shuffle, passTurn, sendLoveNote, submitSoloMove uid fix) — recommend running at the start of Session 6.

---

## Known Issues / Pending Work

### Must fix
~~1. Tile ID collision on page reload~~ — **Fixed in Session 4.** `tiles.ts` now uses `crypto.randomUUID()`.

### Fixed in Session 2 (late) — for reference
- **Swap crash (white screen)**: `handleSwapTileToggle` had no try/catch and the bag guard was `< 7` instead of `< tileIds.length`. Fixed with try/catch/finally and corrected guard.
- **Self-notifications / wrong rack**: `currentSide` was computed from `currentTurn`, causing `me`/`partner` to swap on the opponent's turn. Fixed: use `findIndex` for multiplayer (see Solo Mode section above).

### Fixed in Session 3, re-fixed in Session 4 — for reference
- **Solo swap white screen**: Session 3 applied a `holdForRealtime` lock to prevent a brief stale-rack flash. Session 4 replaced this with an immediate local state update (see Swap Tiles section) after the lock caused a worse regression — UI frozen indefinitely when Realtime was slow.

### Nice to fix
2. **GitHub auto-deploy** — not set up. Every deploy is manual via `netlify deploy --prod --dir=dist --no-build`.

3. **Push notifications end-to-end not fully verified** — the Netlify function has been deployed but the full flow (opponent receives notification when not on page) hasn't been confirmed working.

4. **`Alert.alert` still in `AuthScreen.tsx`** — login/register errors still use `Alert.alert`. Works fine on web (browser native dialog) but inconsistent with the rest of the app.

5. **Pre-existing TypeScript errors** — leftover `src/firebase/` directory from an earlier abandoned Firebase attempt causes TS errors. They don't block the Expo web build (Expo uses Babel/Metro, not `tsc`). Safe to ignore or delete the `src/firebase/` folder entirely.

6. **`exchangeTiles` in `tiles.ts`** — exported but never called anywhere. The swap logic in `swapTiles`/`swapSoloTiles` in `gameService.ts` is inlined. Can be cleaned up.

7. **UI button style inconsistency** — `borderRadius: 10` in LobbyScreen vs `borderRadius: 12` in GameScreen. Low priority. Would benefit from a shared `src/utils/styles.ts`.
