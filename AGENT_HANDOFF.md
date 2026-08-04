# LoveWords — Agent Handoff Document

> Last updated: 2026-08-04 (Session 13 — **Punny Partner/Friend mode subtitles.** The New Game modal's mode pills now show a pun plus a short gloss so the joke reads clearly instead of landing flat: 💕 Partner → *"Love letters"* / "sweet nothings between moves", 🎲 Friend → *"Fighting words"* / "friendly trash talk between moves". Two-line `Text` under the pill label (`modeSub` = pun, `modeGloss` = explanation), both reusing the already-contrast-verified `Colors.textLight` / `Colors.primaryDark` pair so no new contrast-test entries were needed. Explicit `accessibilityLabel` added to each pill so screen readers get the full "mode — pun, gloss" context in one read instead of three separate text nodes. Change is in `src/screens/NewGameModal.tsx` only (`modeToggle` JSX + `modeSub`/`modeGloss`/`modeGlossActive` styles); no test asserts the exact pill copy, so nothing else needed updating. `tsc --noEmit` shows only the 4 pre-existing errors (see Known Issues); **255/255 jest tests pass.**
>
> Earlier (Session 12 — 2026-08-03): **Player invites (email / phone) for people not yet on LoveWords**, and a reworked "New game" flow. Entering an email/phone that has no account no longer dead-ends: it mints a single-use invite (code + link); the invitee opens the link `?invite=CODE` or types the code on sign-up and is dropped into a real game with the inviter. Redemption is atomic and idempotent through the existing `create_active_game` contract. Delivery is by the inviter's **own email app (mailto) or Messages (sms)** — no email/SMS provider needed; optional Resend auto-send is wired but off by default. The New Game modal opens to a **menu first** (🔍 Find a player / 💌 Invite by email or phone / 🎯 Practice solo), each branching to its own focused step with a back arrow — replacing the earlier single-screen layout. See the **Player Invites** notes in the Supabase Tables section below.
>
> **Deploy state:** ✅ **All caught up.** PR #15 → #16 → #17 → #18 are all merged into `main` (base feature + Tom's review fixes, the CSPRNG fix, the ambiguous-column hotfix, and the menu-first flow rework, in that order). The `20260731000100_email_invites.sql` migration is idempotent — re-run it in Supabase only if you're setting up a fresh project; it's already applied to prod. This session's subtitle change is UI-copy-only (no migration, no branch/PR yet — currently uncommitted on `claude/invite-feature-js4o7j`, see below).
>
> Session 11 (2026-07-30): fixed the push-notification & nudge regression from the player-discovery/invites deploy (opaque `sb_secret_…` keys, stale iOS-PWA sessions, `current_time` keyword collision in `claim_notification_delivery`). Session 10 (2026-07-25): finished-game analysis export; in-app AI coaching; score labels; Swap/Pass; tile-bag rebalance; WCAG.
>
> **Deploying?** See `DEPLOY.md` for the full runbook (env vars + scopes, migrations, verify, rollback).

## What This App Is
**LoveWords** is a Words with Friends clone built as a web app (targeting App Store next).
- **Partner mode** (the original): a couple plays async against each other — love notes, 💕 copy
- **Friend mode** (built Session 9): any two friends, same game/engine, neutral copy ("Messages" instead of "Love Notes", non-romantic quick-notes). Smack talk stays in both. Chosen per-game via the New Game modal's Partner/Friend toggle; stored in `games.mode`
- Built with **Expo ~54 / React Native 0.81 / React 19** (web-only today; native iOS/Android is the next milestone)
- Deployed on **Netlify** with auto-deploy on push to `main`
- Backend: **Supabase** (Postgres, Realtime, Auth)
- Push notifications: **Web Push API** with VAPID keys + Netlify serverless function (`web-push` npm package) — **to be replaced with `expo-notifications` for native**
- Dictionary: ENABLE word list (~178k words) fetched from GitHub CDN at runtime, cached in `localStorage`
- **App Store direction**: $2.99 one-time purchase, no ads — EAS Build + App Store submission is next after Expo Push Notifications

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
├── APP_STORE.md                     ← App Store submission kit (listing, privacy, checklist)
├── public/
│   ├── sw.js                        ← Service worker (background push, notificationclick)
│   └── privacy.html                 ← Privacy policy (served at /privacy.html)
├── supabase/
│   └── migrations/
│       ├── 20260723000100_private_game_analysis_events.sql  ← analysis events table + scrub trigger
│       ├── 20260728000100_player_discovery_invites.sql      ← discovery/invites + notification tables & claim RPC
│       └── 20260729000100_notification_claim_timestamp_fix.sql  ← fixes current_time→claim_time (unblocks push/nudge)
├── scripts/
│   ├── generate-icons.js            ← rasterizes assets/logo/icon.svg → PNGs
│   ├── inject-web-meta.js           ← injects PWA/iOS meta into dist/index.html
│   └── dev-analysis-server.js       ← local mock analysis endpoint (npm run dev:analysis)
├── netlify/
│   └── functions/
│       ├── notify.js                ← Serverless: receives POST, sends Web/Expo push
│       ├── delete-account.js        ← Account deletion
│       ├── game-analysis-common.js  ← Shared auth + sanitizeGameExport helpers
│       ├── game-analysis-token.js   ← Issues 1-hour analysis capability tokens
│       ├── game-analysis.js         ← Returns sanitized game JSON for a token
│       └── game-coach.js            ← AI coaching via Claude (@anthropic-ai/sdk)
└── src/
    ├── screens/
    │   ├── AuthScreen.tsx           ← Login / Register form
    │   ├── LobbyScreen.tsx          ← Home: game list, New game hero, Active/Past tabs, delete
    │   ├── NewGameModal.tsx         ← Partner/Friend toggle + email invite + Practice Solo
    │   ├── GameScreen.tsx           ← Main game + finished-game coaching (the core)
    │   └── LoveNotesModal.tsx       ← In-game chat/love notes (mode-aware copy)
    ├── components/
    │   ├── BoardComponent.tsx       ← 15×15 board, exports getCellSize(); uses Gesture.Pan
    │   ├── TileRack.tsx             ← Drag rack with react-native-gesture-handler (drag + tap)
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
        ├── colors.ts                ← Color palette (WCAG AAA light pink/rose theme)
        ├── styles.ts                ← Shared design tokens: RADII (sm/md/lg/xl) and SHADOWS (card/btn)
        ├── apiBase.ts               ← FUNCTIONS_BASE for calling the Netlify functions
        ├── webNotifications.ts      ← in-tab Notification() helpers
        ├── notifications.ts         ← native Expo push registration
        ├── pushSubscription.ts      ← Web Push SW registration + push_subscriptions upsert
        ├── appBadge.ts              ← setupBadgeClearing() (Badging API, iOS PWA)
        └── purchases.ts             ← MONETIZATION_ENABLED flag (RevenueCat, dormant for v1.0)

(Not shown: __tests__/ — 11 Jest suites; assets/ — icons/logo.)
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

### Netlify Environment Variables (for the serverless functions)
```
VAPID_PUBLIC_KEY=<public key — same value as in pushSubscription.ts>
VAPID_PRIVATE_KEY=<private key — REDACTED, see Netlify env settings>
VAPID_EMAIL=<any email, identifies sender to push services>
SUPABASE_URL=<same as src/supabase/config.ts>
SUPABASE_SERVICE_KEY=<service role key, NOT anon key — has full DB access>
ANALYSIS_TOKEN_SECRET=<HMAC secret for finished-game analysis-export tokens; openssl rand -base64 32; ≥32 bytes>
ANTHROPIC_API_KEY=<Claude API key for the AI game-coach function (game-coach.js)>

# OPTIONAL — invite email auto-send (send-invite.js). Leave ALL unset and email
# invites still work: the inviter taps "📧 Email invite" and their own mail app
# opens pre-written (mailto), so no provider/domain is required. Set these only
# to have the app auto-send the email itself.
RESEND_API_KEY=<Resend API key; when set, send-invite emails the invite via Resend>
INVITE_FROM_EMAIL=<e.g. "LoveWords <play@yourdomain>"; needs a Resend-verified domain; else defaults to onboarding@resend.dev>
APP_URL=<public origin for invite links; defaults to the Netlify site URL>
```
> ⚠️ Resend's shared `onboarding@resend.dev` sender can only deliver to your own
> Resend account email. To email invites to **anyone**, you must verify a domain
> in Resend. Because of that, the shipped default is the mailto/Messages flow
> (no provider), and `RESEND_API_KEY` is genuinely optional.

**All server-only — Functions-scoped, Production context.** Set them so the
`Functions` scope is enabled (not Builds-only), or the running function returns
a 500 ("… is not configured"). Never add `SUPABASE_SERVICE_KEY`,
`ANALYSIS_TOKEN_SECRET`, `ANTHROPIC_API_KEY`, or `RESEND_API_KEY` to
`SECRETS_SCAN_OMIT_KEYS` — they're server-only and must never appear in the
client bundle. New env vars bind at **deploy time**: after adding one, redeploy
(Clear cache and deploy). A **secret** var must not use the Post-processing
scope — scope it to Functions (+Runtime), or Netlify rejects it ("access
denied").

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
- `--no-build` is required for manual CLI deploys — without it, Netlify CLI tries to install extensions and 403s
- Rate limit (429 Too Many Requests): wait 10-15 min between deploys
- Netlify CLI requires `netlify login` first; the auth token is NOT available in the agent environment — user must run from their own terminal
- **Auto-deploy is live**: pushing to `main` triggers Netlify CI using `npm run build:web`. The old `ignore = "exit 1"` was removed in Session 8.

```toml
# netlify.toml (current state)
[build]
  command = "npm run build:web"
  publish = "dist"

[build.environment]
  NODE_VERSION = "20"
  SECRETS_SCAN_OMIT_KEYS = "SUPABASE_URL,VAPID_PUBLIC_KEY"

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
| `mode` | text | `'partner'` \| `'friend'` — relationship mode (Session 9). Default `'partner'` |
| `moves` | jsonb | `Move[]` array |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Migration for existing installs** (in `supabase_schema.sql`, safe to re-run):
```sql
alter table games add column if not exists mode text not null default 'partner';
```

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

### `notification_rate_limits` / `notification_delivery_events`
Service-role-only bookkeeping behind the server-authorized `notify` function
(migration `20260728000100`). `notification_rate_limits` enforces per
sender→recipient→type cooldowns and hourly caps; `notification_delivery_events`
dedupes immutable events (turn/lovenote/invite) so the same event can't be
replayed. Both are written **only** by the `claim_notification_delivery(uuid,
uuid, text, text)` RPC (security-definer, granted to `service_role` only), which
`notify` calls before sending. **Do not name a PL/pgSQL variable `current_time`
in that function** — it collides with the `CURRENT_TIME` keyword and every claim
throws `42804` (this was the Session 11 `E502`); the corrected function uses
`claim_time`.

### `email_invites` / `email_invite_claim_limits`
Migration `20260731000100_email_invites.sql` (idempotent — safe to re-run).
Holds invites to people **not yet on the app** (both email and phone; the name
is historical). Columns: `code` (unique, 8 chars), `inviter_uid`,
`invitee_email` / `invitee_phone` (at least one; email nullable), `mode`,
`status` (`pending`/`accepted`/`revoked`), `redeemer_uid`, `game_id`,
`emails_sent`, `last_email_at`, `expires_at` (+14d). RLS: inviter reads their
own; all writes go through security-definer RPCs. Key functions:
- `create_email_invite(email, mode)` / `create_phone_invite(phone, mode)` →
  mint a code (dedupes per inviter+contact, caps 10 pending/hour). Codes come
  from `_generate_invite_code()` using `gen_random_uuid()` (a strong-RNG CSPRNG
  source that doesn't depend on pgcrypto being on the search_path) with
  rejection sampling.
- `redeem_email_invite(code, board, bag, rack1, rack2)` → **atomic**: creates
  the active game (redeemer = player 1) via `create_active_game` AND marks the
  invite accepted in one transaction; idempotent replay returns the same
  `game_id`. **RETURNS null (never RAISEs) on expected failure** so the
  per-account attempt counter in `email_invite_claim_limits` (20/hour) commits
  even for a bad code — raising would roll the increment back.
- `claim_invite_email_delivery(code, sender_uid)` (service-role only) → atomic
  gate for `send-invite.js`: ownership + pending + not-expired + 60s cooldown +
  5-emails-per-invite cap.
- `find_profile_by_email` now **raises** `Too many lookups` on throttle (was a
  silent empty result) so the New Game flow doesn't mistake a throttle/error
  for "not a member." Client `getUserByEmail` throws on error, returns null only
  for a confirmed miss.

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

type GameMode = 'partner' | 'friend';  // relationship mode (Session 9)

type Game = {
  id: string;
  players: [Player, Player];
  board: Board;
  bag: Tile[];
  currentTurn: string;  // uid
  status: GameStatus;
  mode: GameMode;       // non-optional; rowToGame defaults old rows to 'partner'
  moves: Move[];
  createdAt: number;
  updatedAt: number;
  loveNotes?: LoveNote[];
};
```

---

## Colors (`src/utils/colors.ts`)
This is a **light pink/rose theme** (NOT dark). Deepened for **WCAG 2.1 AAA**
(7:1 normal text / 4.5:1 large) in Session 9 — the values below are the current,
hardened palette (`colors.ts` is the source of truth):
```ts
primary: '#A8005F'       // deep rose — fills behind white text; primary text on white
primaryLight: '#FF6EB4'
primaryDark: '#7A0046'   // primary-colored TEXT on light bgs (titles, links, initials)
accent: '#FF4081'
background: '#FFF0F5'     // very light pink
surface: '#FFFFFF'
text: '#2D0A1E'          // near-black
textLight: '#7A3453'     // secondary text (do NOT place on tilePlaced fill)
errorDark: '#9B1C1C'     // error text + delete buttons (white-on-it 8.2:1)
border: '#F0A8C8'
boardBg: '#1A0A12'       // dark board background
emptyCell: '#2D1420'
tileDefault: '#FFFFFF'
tileText: '#2D0A1E'
tileSelected: '#FF6EB4'
tilePlaced: '#FFD6EC'
// Bonus squares deepened so their labels hit AAA (TW/DW/TL/START white, DL dark):
tw: '#A01818'   dw: '#A8005F'   tl: '#124C8F'   dl: '#7DC2F7'   start: '#8E1050'
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
| `sendLoveNote(gameId, fromUid, toUid, message, emoji)` | Inserts note row, then sends a `lovenote` push (sender name/mode resolved server-side from the DB, not passed by the client) |
| `subscribeToLoveNotes(gameId, cb)` | Fetches notes ordered by created_at desc + INSERT subscription |
| `markNoteRead(noteId)` | Sets read = true |
| `deleteGame(gameId)` | Deletes game row; requires RLS delete policy on games table |
| `createGame(p1, p2, mode?)` | **(updated Session 9)** now takes an optional `mode: 'partner' \| 'friend'` (default `'partner'`) written to the new `mode` column |

### Solo-only functions (NEVER touch current_turn)
| Function | Description |
|---|---|
| `createSoloGame(player)` | Both players uid = player.uid; player2 email = 'solo'; current_turn = player.uid forever |
| `submitSoloMove(gameId, game, playerIndex, placedTiles)` | Updates board/rack/score for the given index; omits current_turn from update |
| `passSoloTurn(gameId, game)` | Appends pass move to moves array; no current_turn change |
| `swapSoloTiles(gameId, game, playerIndex, tileIds)` | Swaps tiles for given player index; no current_turn change |

### Invite / matchmaking functions
| Function | Description |
|---|---|
| `createGameInvite(p1, p2, mode)` | In-app invite between two **existing** members found via name search; inserts an inert `waiting` game the recipient accepts. |
| `acceptGameInvite` / `declineGameInvite` / `cancelGameInvite` | Transition a `waiting` invite (deal tiles on accept; scoped, RLS-guarded). |
| `createEmailInvite(email, mode)` / `createPhoneInvite(phone, mode)` | Mint a single-use code (+ shareable link) for someone **not on the app**; returns `{ code, link }`. |
| `sendInviteEmail(code)` | Best-effort: asks `send-invite.js` to email the invite (only sends if `RESEND_API_KEY` set); returns whether it actually emailed. Never throws. |
| `redeemEmailInvite(code)` | Generates tiles client-side, calls the atomic `redeem_email_invite` RPC; returns `{ status: 'created', gameId }` or `{ status: 'gone' }`. `App.tsx` clears the stashed code only on a confirmed outcome (keeps it to retry on transient error). |

Pure helpers in `src/utils/invites.ts` (normalize/format/validate code, build/parse `?invite=` link) and `src/utils/pendingInvite.ts` (stash/read/clear the pending code across storage). `NewGameModal` routes an entered email→`onStart`, phone→`onStartPhone`; the invite panel opens the inviter's mail app (mailto) or Messages (sms) prefilled.

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

**Session 8:** Rewrote from `PanResponder` (web-only pointer events) to `react-native-gesture-handler` (`Gesture.Pan` + `GestureDetector`). This unblocks native iOS/Android builds. `GestureHandlerRootView` is already in `App.tsx`.

- **Both drag and tap work for placing tiles.** Drag is primary on mobile; tap-to-select is the web fallback.
- **`TileRack.tsx`** — `DraggableTile` inner component wraps each tile in a `GestureDetector`
- **`BoardComponent.tsx`** — `DraggablePendingTile` inner component — same pattern — for tiles already placed on the board (drag to reposition without recalling)
- **Tap vs drag threshold**: 5px — tracked manually in the `.onBegin`/`.onUpdate` handlers since RNGH's `minDistance` fires too late for the tap path

### Gesture pattern (same in both TileRack and BoardComponent)

```ts
// Gesture created once with useMemo(()=>..., []) — mutable state via refs
const gesture = useMemo(() =>
  Gesture.Pan()
    .runOnJS(true)        // callbacks run on JS thread (needed for setState)
    .minDistance(0)       // receive events from the very first touch
    .onBegin((e) => {
      dragStartedRef.current = false;
      startXRef.current = e.absoluteX;
      startYRef.current = e.absoluteY;
    })
    .onUpdate((e) => {
      const dx = e.absoluteX - startXRef.current;
      const dy = e.absoluteY - startYRef.current;
      if (!dragStartedRef.current &&
          (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragStartedRef.current = true;
        dragCallbacksRef.current?.onDragStart(tileRef.current, e.absoluteX, e.absoluteY);
      }
      if (dragStartedRef.current) dragCallbacksRef.current?.onDragMove(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      if (dragStartedRef.current) dragCallbacksRef.current?.onDragEnd(e.absoluteX, e.absoluteY, tileRef.current);
      else onTilePressRef.current();   // tap — no drag started
      dragStartedRef.current = false;
    })
    .onFinalize(() => {
      // Interrupted mid-drag (e.g. incoming call) — clean up
      if (dragStartedRef.current) { dragCallbacksRef.current?.onDragCancel(); dragStartedRef.current = false; }
    }),
[], // created once; all state via refs
);
```

**⚠️ Ref pattern is required.** The gesture object is created once (`useMemo([])`). All prop values that change (`tile`, `disabled`, `onTilePress`, `dragCallbacks`) are mirrored into refs via `useEffect` and read as `xyzRef.current` inside handlers. Never access props directly inside the gesture — they'll be stale.

### Rest of the drag flow (unchanged from Session 7)
- `onDragStart` → `handleDragStart` (rack) or `handleBoardTileDragStart` (board) in `GameScreen`
- `onDragMove` → updates `Animated.ValueXY` (`dragXY`), offset -25px to center on fingertip
- `onDragEnd` → `handleDragEnd`: functional updater `setPendingTiles(prev => ...)` to avoid stale closures
- Floating tile: `Animated.View` outside the `ScrollView`, `absoluteFillObject`, `zIndex: 999`, `pointerEvents="none"`
- Tile fades to `opacity: 0.3` while dragging (`draggingTileId` prop)
- Swap mode: `dragCallbacks` and `boardTileDragCallbacks` both set to `undefined` to disable drag
- Cell size: `getCellSize()` (exported from `BoardComponent.tsx`) uses `Dimensions.get('window')` — cross-platform, no `window.innerWidth`

### TileRack extras (Session 7/8)
- **Shuffle button** (🔀): `onShuffle` optional prop; appears to the right of the rack; disabled when < 2 tiles
- **Responsive tile size**: `useWindowDimensions` + `MAX_TILE_SIZE = 46`; tiles shrink on narrow screens so all 7 + the shuffle button fit
- **Empty slots**: grey placeholder `View`s fill the remaining 7-tile width

---

## Game-End Conditions

The game sets `status: 'finished'` in two ways:

1. **Player goes out**: `submitMove` / `submitSoloMove` check `newBag.length === 0 && newRack.length === 0`. When the bag empties and the active player uses their last tiles, the game ends.

2. **Consecutive passes** (added Session 8): `passTurn` / `passSoloTurn` call `trailingPassCount(game.moves)`. When the 4th consecutive pass lands (`CONSECUTIVE_PASS_LIMIT = 4`, i.e. 2 passes each player), `status` is set to `'finished'`. This covers the stuck case where neither player has a valid play.

```ts
// gameService.ts — top of file
const CONSECUTIVE_PASS_LIMIT = 4;

function trailingPassCount(moves: Move[]): number {
  let count = 0;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].uid === 'pass') count++;
    else break;
  }
  return count;
}

// Inside passTurn / passSoloTurn:
const isFinished = trailingPassCount(game.moves) + 1 >= CONSECUTIVE_PASS_LIMIT;
// then include status: isFinished ? 'finished' : 'active' in the update
```

**Game-over screen** (`GameScreen.tsx`): detects the pass-end case with `game.moves.slice(-4).every(m => m.uid === 'pass')` and shows an italic *"No more moves — game ended by passes"* note below the winner text.

**Not implemented** (vs real Scrabble): end-of-game tile penalty (subtracting remaining rack tile values from each player's score). Low priority for a casual app.

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

`Alert.alert` is **not used anywhere in the app** (fixed in Session 8 — AuthScreen was the last holdout).

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
3. **`gameService.ts`**: `sendPushNotification(recipientUid, type, gameId, eventId?)` POSTs to `/.netlify/functions/notify` with the caller's **Supabase access token** as `Authorization: Bearer`. `submitMove` sends `type:'turn'` (eventId = move index), `sendLoveNote` sends `type:'lovenote'` (eventId = note id), invites send `type:'invite'`, and the nudge button sends `type:'nudge'` (no eventId). On a 401 it refreshes the session once and retries (covers suspended iOS PWAs handing back an expired token). Returns `'sent' | 'cooldown' | { status:'failed', code }` where `code` is a safe diagnostic (`E<status>` / `ESESSION` / `ENETWORK`).
4. **`netlify/functions/notify.js`** (server-authorized): validates the Bearer token via `/auth/v1/user` to get the real `senderUid` → loads the game with the **service role key** → authorizes by type (participant match + turn/event/note binding) → **claims the delivery** atomically via the `claim_notification_delivery` RPC (dedupe + per-pair cooldown + hourly cap; nudge = 1/hr) → fetches the recipient's Web Push sub + Expo token → sends both best-effort. A 410 from Web Push deletes the stale subscription row. Sender name and `isFriend` come from the DB, never the client.
5. **`public/sw.js`**: Receives `push` event → calls `self.registration.showNotification()` → on `notificationclick`, focuses existing window or opens new one

### Service-role key handling (why push once 502'd)
`notify` (and `delete-account`, `game-analysis-common`) talk to the Data API with `SUPABASE_SERVICE_KEY`. New-format **opaque secret keys (`sb_secret_…`) must go in the `apikey` header only** — sent as `Authorization: Bearer` they 401 (JWT parse fails) → the function returns 502. Legacy service-role JWTs still use the Bearer form. The helper sets Bearer only when the key does **not** start with `sb_secret_`. Use the secret/`service_role` key here, never the `anon`/`publishable` one.

### In-tab notifications
`webNotifications.ts` also has `sendTurnNotification` and `sendLoveNoteNotification` which use `new Notification(...)` directly (works when tab is open/focused, no service worker needed).

### Notes
- Fails silently everywhere — push errors never break game actions (best-effort; the nudge button is the one place a failure is surfaced, as a safe code)
- `node_bundler = "nft"` in `netlify.toml` is required for `web-push` to bundle correctly (esbuild fails)
- Push subscription is stored one-per-user (upsert on conflict `user_id`)
- Auth/rate-limit tables (`notification_rate_limits`, `notification_delivery_events`) and the `claim_notification_delivery` RPC come from the `20260728000100` migration; the `20260729000100` migration fixes the `current_time`→`claim_time` keyword collision that otherwise makes every claim throw (→ 502 → "Could not nudge (E502)")

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
- `createTileBag()` — WWF-style distribution (104 tiles: 9×A, 11×E, 8×I, 8×O, 7×R, 5×S, 8×T, 2 blanks, etc.), shuffled with Fisher-Yates. E was trimmed 13→11 (→ R, T) to cut vowel-heavy racks — see the comment in `tiles.ts` for the full rationale. Changing counts only affects **new** games.
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

## Finished-Game Analysis & AI Coaching

Two serverless features let a player review a **finished** game. Both authenticate
the caller's Supabase session and confirm they're a player of a `status:'finished'`
game before doing anything. Shared server helpers live in
`netlify/functions/game-analysis-common.js` (`fetchSupabaseUser`, `fetchGame`,
`fetchAnalysisEvents`, `sanitizeGameExport`, `jsonResponse`, `parseBearer`, `isUuid`).

### 1. Analysis export (PR #3, `finished-game-analysis-export`)
A sanitized, versioned JSON export designed to be fed to an external AI via `curl`.
- **`game-analysis-token.js`** — `POST /api/games/:id/analysis-token`; auth via Supabase
  session → returns a 1-hour, game-scoped HMAC capability token (signed with
  `ANALYSIS_TOKEN_SECRET`).
- **`game-analysis.js`** — `GET /api/game-analysis` with `Authorization: Bearer <token>`
  → returns `sanitizeGameExport(...)` (players, per-move words/scores, `recordingQuality:
  'full'|'basic'`). Never exposes the raw `games` row.
- **DB**: `game_analysis_events` table + a `before update` trigger
  (`supabase/migrations/20260723000100_private_game_analysis_events.sql`) that captures
  v2 event private fields (`rackBefore`/`drawnTiles`/`returnedTiles`) into that table and
  scrubs them from participant-readable `games.moves`. **Run this migration before the
  functions go live** (it's transactional + idempotent).
- Local review: `npm run dev:analysis` (mock server on :8088) + `?dev=1`.

### 2. AI coaching (in-app) — `game-coach.js`
Turns that same export into a written coaching note shown **inside the app** (no curl).
- **`game-coach.js`** — `POST /api/games/:id/coach`; auth via Supabase session → builds
  `sanitizeGameExport(...)` → calls the **Claude API** (`@anthropic-ai/sdk`,
  `COACH_MODEL = 'claude-sonnet-5'`, `thinking:{type:'adaptive'}` + `output_config:{effort:'low'}`)
  → returns `{ analysis, recordingQuality }`. Requires **`ANTHROPIC_API_KEY`** in Netlify
  (secret, **Functions**-scoped — not "All scopes", since secrets can't use Post-processing).
  ~4¢/game. `claude-opus-5` is more precise but pricier/slower; `claude-haiku-4-5` is cheapest
  but too vague for concrete better-play advice (and rejects the thinking/effort params).
- **Client**: `requestGameCoaching(gameId)` in `gameService.ts` (has a `?dev=1` canned
  mock). Wired into the finished-game screen in `GameScreen.tsx` — the "🤖 Coach me on
  this game" button renders the returned text in a card. (This replaced the old
  curl-command UI; the analysis-token/export endpoints above still exist for power users.)
- **Recording quality**: coaching is only rack-aware for **v2 games** (created after the
  analysis feature shipped) — those return `recordingQuality: 'full'` and get concrete
  "you should have played X" advice. Older games return `'basic'` (no per-turn rack was
  ever recorded — unrecoverable); the card shows an "played before full move tracking" note
  and the coach gives higher-level feedback only. This is expected, not a bug.
- **Latency note**: Sonnet + adaptive thinking on a long game can approach the Netlify
  sync-function timeout; if that shows up, drop the `thinking` param, lower effort, or stream.
- **App Store TODO**: gate the coach behind premium — wire the "Coach me" button to the
  dormant `MONETIZATION_ENABLED` flag in `src/utils/purchases.ts` so it's premium-only when
  monetization is turned on. Not gated today (free for everyone).

---

## Tests

**255 unit tests across 23 suites**, all passing. Run with:
```bash
npx jest            # (package.json "test" script runs jest --coverage)
```
Suites include `board`, `scoring`, `tiles`, `swap`, `dictionary`, `gameHistory`, `gameServiceHistory`, `analysis*`, `contrast`, `playerDiscovery*`, `gameInvites`, and the invite suites: `invites` (pure helpers), `emailInvites` (service layer), `emailInvitesSql` (SQL-contract assertions over the migration **and** `supabase_schema.sql`), plus `playerDiscoveryUiContract` (asserts the New Game modal's flow strings). All in `__tests__/`. Always run after touching `src/engine/`, `src/supabase/gameService.ts`, the analysis functions, the invite SQL/migration, or the New Game modal. **The SQL-contract tests read both the migration and the schema snapshot — keep the two in sync when editing invite SQL.**

---

## Known Issues / Pending Work

### App Store path (IN PROGRESS — Session 9). See `APP_STORE.md` for the full submission kit.
**Decision: v1.0 ships FREE** (no IAP) to keep the first submission simple; the "3 free games → $2.99 unlock" is a v1.1 fast-follow. Status:
1. **Native push** — ✅ **DONE.** `netlify/functions/notify.js` already sent Expo push (native) alongside Web Push (PWA); Session 9 made the copy **mode-aware** (`isFriend` threaded through `sendPushNotification`/`sendLoveNote`/`sendNudge` → friend games get neutral "💬 Message"/nudge text). Client registration in `src/utils/notifications.ts`. Still needs `eas init` (fills the placeholder `projectId` in `app.json`) and an APNs key (EAS auto-configures at build time).
2. **Free launch wiring** — ✅ `MONETIZATION_ENABLED = false` in `src/utils/purchases.ts` (RevenueCat never initializes, paywall never fires). `FREE_GAME_LIMIT = 3` set in `LobbyScreen.tsx` for v1.1. Paywall/RevenueCat code intact but dormant. **v1.1:** flip the flag to `true`, paste the real RevenueCat key, create the $2.99 non-consumable IAP in App Store Connect + RevenueCat.
3. **App icon** — ✅ Apple rejects icons with alpha; `assets/icon.png` was opaque-but-had-an-alpha-channel, so `assets/icon-ios.png` (alpha stripped via sharp) is wired via `app.json` `ios.icon`.
4. **Privacy policy** — ✅ `public/privacy.html` (serves at `/privacy.html`), updated Session 12 to disclose invite **contact details** (email/phone you enter — never the device address book) and **Resend** as the optional email processor. Matching App Privacy answers (added "Contact Info — Phone Number") in `APP_STORE.md`. ⚠️ Still replace the `ADD-YOUR-CONTACT-EMAIL-HERE` placeholder before submit.
5. **Listing copy / keywords / review notes / App Privacy answers / pre-submit checklist** — ✅ all in `APP_STORE.md`.
6. **EAS Build + submit** — ⏳ blocked on the Apple Developer Program account (user enrolling; $99/yr). Then `eas init` → `eas build --platform ios --profile production` → App Store Connect app record → `eas submit`. Bundle ID is `com.lovewords.app`.
7. **Screenshots** — ⏳ best captured from the iOS Simulator at 1290×2796 once built; framing/captions in `APP_STORE.md`.
8. **Friend mode** — ✅ **DONE (Session 9).** See the "Partner/Friend Mode + Home Screen" section below.
9. **Player invites (email/phone) + New Game flow rework** — ✅ **DONE and merged to `main`** (PRs #15–#18; see the Deploy state note at the top). Delivery defaults to the inviter's own mail app / Messages (no provider). Menu-first flow (Find / Invite / Solo) shipped in Session 12; Session 13 added punny mode-pill subtitles ("Love letters" / "Fighting words" with a plain-language gloss under each) — currently uncommitted, see the header note.
10. **"Add from Contacts" on the invite field** — ⏳ **Deferred, by user decision (Session 13).** No web API exists for a Contacts *picker* on iOS Safari/PWA (Apple has never implemented the W3C Contact Picker API) — this is a platform wall, not a bug. Android Chrome does support it (`navigator.contacts.select`) as a progressive enhancement, and `textContentType`/`autoComplete` hints on the contact `TextInput` in `NewGameModal.tsx` would let iOS's QuickType bar suggest a matching contact while typing, but neither was built — the user explicitly chose to wait for the native app instead of building either partial option. **A real contacts picker on iOS only becomes possible once the native app ships** (`expo-contacts` via EAS Build — see item 6 above, blocked on Apple Developer Program enrollment). If this comes up again: don't re-investigate from scratch, just confirm the EAS Build status and revisit then. Note also: `public/privacy.html` currently states invite contacts are "never the device address book" — that claim would need updating if a contacts picker is ever added.

⚠️ **User-generated content / review risk:** players send free-text messages. v1.0 is invite-only (low risk) but Apple may ask about UGC; block/report/filter becomes mandatory once **Phase 2 random matchmaking** ships.

### Nice to fix
5. **Push notifications end-to-end not fully verified** — the Netlify function has been deployed but the full flow (opponent receives notification when not on page) hasn't been confirmed working end-to-end.

6. **Pre-existing TypeScript errors** — leftover `src/firebase/` directory from an earlier abandoned Firebase attempt causes TS errors. They don't block the Expo web build (Expo uses Babel/Metro, not `tsc`). Safe to ignore or delete the `src/firebase/` folder entirely.

7. **`exchangeTiles` in `tiles.ts`** — exported but never called anywhere. The swap logic in `swapTiles`/`swapSoloTiles` in `gameService.ts` is inlined. Can be cleaned up.

### Built this session (Session 9) — Partner/Friend Mode + Home Screen redesign
- **New Game modal** (`src/screens/NewGameModal.tsx`): Partner 💕 / Friend 🎲 toggle + email invite + "Practice Solo". Opened by the new **➕ New game** hero button on the lobby. Passes the chosen `mode` into `createGame(p1, p2, mode)`.
- **Home screen** (`LobbyScreen.tsx`) rewritten + redesigned: avatar+greeting header with a circular settings button, a magenta **New game** hero CTA, segmented **Active / Past** tabs (Active = `status!=='finished'`, Past = `finished`; **Archived was removed by request**), per-tab counts, and polished game cards (opponent initials avatar, mode badge 💕/🎲/🎯, a "Your turn" status chip, stacked score). Long-press a card → **Delete** (permanent) + Cancel.
- **Login screen** (`AuthScreen.tsx`) redesigned: logo halo, floating white card, segmented **Sign in / Sign up** toggle (replaces the bottom text link), refined inputs + CTA. Same visual system as the home screen (`SHADOWS`/`RADII` tokens, rounded cards, magenta accents).
- **Schema**: added `games.mode` (`'partner'|'friend'`) only — see the games table + migration block above. No `archived` column. No RLS change.
- **Types**: `GameMode` added; `Game` gained `mode` (non-optional; `rowToGame` defaults it to `'partner'` for old rows).
- **Service**: `createGame` takes `mode`; `createSoloGame` writes `mode:'partner'`; `createRematch` carries the mode through. (No `archiveGame` — archive feature was dropped.)
- **Friend-mode copy (lightweight relabel)**: `LoveNotesModal` takes `isFriend` → title "Messages 💬", "Write a message…", 💬 send emoji, and a **punny (non-romantic) `FRIEND_QUICK_NOTES`** set (word/game jokes — "Tile me impressed 👏", "That word was un-be-letter-able 🔤", …). Partner keeps the romantic `QUICK_NOTES`. `GameScreen` derives `isFriend = game.mode==='friend'` → "💬 Chat" button, neutral 🎲 turn banner, and the 2 romantic smack-talk lines swapped for neutral ones (`FRIEND_SMACK_OVERRIDES`). Partner mode is unchanged.
- **⚠️ Deploy step**: run the single `alter table … add column mode` statement in Supabase before deploying (existing games default to partner).
- **WCAG AAA (contrast) — palette hardened**: the brand was deepened for 7:1 text contrast (AAA normal; 4.5:1 large). Tokens in `colors.ts`: `primary #A8005F` (white-on-fill 7.42, primary-text-on-white 7.42), `primaryDark #7A0046` (primary text on light bgs / tilePlaced ≥8.4, on white 10.96), `textLight #7A3453` (secondary text: 8.6 on white, 7.8 on pink bg — **not** to be placed on the `tilePlaced` fill, only 6.6 there), and new `errorDark #9B1C1C` (error text + delete buttons; white-on-it 8.15, text-on-banner 7.36). All hardcoded `#C0392B`/`'red'` error colors across every screen were swapped to `Colors.errorDark`. A Node contrast script verified **every text pair ≥7:1** on the redesigned screens + ScoreBoard + game chrome (the 28px score is large so its 6.75 on pink passes AAA-large). The board's brighter `dw`/`tw` bonus pinks are unchanged (see caveat).
- **Emoji accessibility (WCAG 1.1.1 / 1.4.1, Level A)**: game cards got a single descriptive `accessibilityLabel` (e.g. "Friend game with Sam, Your turn, score 12 to 8") and their inner decorative content (avatar, badges, score) is hidden from screen readers via `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` — so the mode (💕/🎲) is announced in words, not as "two hearts / game die", and emoji aren't read individually.
- **⚠️ NOT yet AAA — the game board bonus-square labels** (`BoardComponent.tsx`): the "TW/DW/TL/DL" labels are 85%-opacity white/dark on the colorful bonus squares. Several are <7:1 and the **DW pink square fails even AA**. Making them AAA means recoloring the iconic WWF bonus squares (a deliberate design change) — deferred pending that decision.
- **Phase 2 (not built)**: random matchmaking — deferred; needs an RLS rewrite (current policies assume both uids known at insert) + stranger-safety design.
- **Verified (Session 9)**: `tsc` introduces no new errors (4 pre-existing remain); 63/63 jest tests pass. Driven end-to-end in the live Expo dev server via the `?dev=1` mock: redesigned home + New Game modal + Partner/Friend toggle, a Friend game created and entered, and the in-game relabel confirmed ("💬 Chat", 🎲 banner, "Messages 💬" chat with neutral quick-notes). Active/Past tabs only.

### Fixed this session (Session 8) — for reference
- **Drag system** (Issues 23/29): Rewrote `TileRack.tsx` and `BoardComponent.tsx` from `PanResponder` + web pointer events to `react-native-gesture-handler` (`Gesture.Pan` + `GestureDetector`). Unblocks native builds. Also merged boyfriend's shuffle button and responsive tile sizing.
- **Issue 8** (`Alert.alert` in `AuthScreen`): Replaced with inline dismissable error banner. No more browser native dialogs.
- **Issue 5 partial** (borderRadius inconsistency): Added `src/utils/styles.ts` with `RADII`/`SHADOWS` tokens. LobbyScreen invite input/button updated from 10→12 to match rest of app.
- **Login tagline**: Updated to "A game for word lovers 💬".
- **Auth screen logo**: Replaced `💌` emoji with `<Image source={require('../../assets/icon.png')}>` — matches the home screen icon (pink tile, heart, "8").
- **Auto-deploy**: Removed `ignore = "exit 1"` from `netlify.toml`. Pushes to `main` now trigger Netlify CI automatically.
- **Consecutive pass end**: Game now ends after 4 consecutive passes (2 each). `passTurn` and `passSoloTurn` both check `trailingPassCount`. Game-over screen shows reason when triggered this way.
