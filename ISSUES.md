# Lovewords — Active Bug & UX Issues

> Updated 2026-07-06 (Session 7). Pass this to the next agent alongside `AGENT_HANDOFF.md`.
> All file paths are relative to `C:\Users\victo\lovewords\`.
> ✅ = resolved  🔴 = critical  🟠 = high  🟡 = medium

---

## ✅ Issue 1 — Tile ID collision after page reload (FIXED — Session 4)

**Symptom:** After a page reload, newly drawn tiles got IDs starting from `tile_0` again, colliding with IDs already in Supabase. The rack filter (`rack.filter(t => !usedIds.has(t.id))`) incorrectly removed tiles that were never played, corrupting the rack.

**Root cause — `src/engine/tiles.ts`:**
```ts
let _tileIdCounter = 0;  // resets to 0 on every page reload
id: `tile_${_tileIdCounter++}`,
```

**Fix applied — `src/engine/tiles.ts`:**
Removed `_tileIdCounter` entirely. Replaced with `crypto.randomUUID()`, which is a native browser API — no polyfill needed since the tsconfig includes `"lib": ["DOM", "ESNext"]` and this is a web-only build. IDs are now collision-proof across reloads and sessions.

**Note:** Previous attempts referenced `react-native-get-random-values` as a required polyfill — that package is not installed and not needed for a web target.

---

## ✅ Issue 2 — Tiles can be stacked on board cells (FIXED — Session 2)

**2a.** `BoardComponent.tsx`: outer cell `TouchableOpacity` now `disabled={!!pending || !canPlace}` — disabled when a pending tile is present.

**2b.** `GameScreen.tsx` `handleDragEnd`: uses functional updater `setPendingTiles(prev => ...)` to read latest pending tiles without stale closure.

---

## ✅ Issue 3 — Solo play unreliable (FIXED — Session 2)

**3a.** Old broken solo games (pre-uuid-fix) deleted from Supabase manually. New games are clean.

**3b.** `prevMovesLengthRef` initialised to `-1` (sentinel). First Realtime update sets the ref without triggering a spurious state clear.

**3c.** After `submitSoloMove` succeeds, `submitting` stays `true` via `soloWaitingRealtimeRef`. The Realtime callback clears it when `moves.length` changes, ensuring the new rack has arrived before the UI unlocks.

---

## ✅ Issue 4 — Jarring tile selection animation (FIXED — Session 2)

`TileComponent.tsx`: removed `translateY: selected ? -6 : 0`, reduced scale from `1.18` to `1.08`, quieted shadow. Selection is indicated by a thicker border (`2.5px`) and subtle scale only — no layout shift.

---

## ✅ Issue 5 — UI inconsistency (PARTIALLY FIXED — Session 2)

**Fixed:** `Alert.alert` removed from `LobbyScreen.tsx` — all errors are now inline banners.

**Still open:**
- `AuthScreen.tsx` still uses `Alert.alert` for login/register errors
- Button `borderRadius` differs between LobbyScreen (10) and GameScreen (12)
- No shared `src/utils/styles.ts` for button/card tokens

**Severity:** 🟡 Medium

---

## ✅ Issue 6 — Cannot delete a game (FIXED — Session 2)

`gameService.ts`: `deleteGame(gameId)` added.

`LobbyScreen.tsx`: long-press (500ms) on a game card shows an inline confirm. Tapping Delete calls `deleteGame`.

**Requires Supabase RLS policy** (run once in SQL Editor — may not be done yet):
```sql
CREATE POLICY "Players can delete their games"
ON games FOR DELETE
USING (player1_uid = auth.uid() OR player2_uid = auth.uid());
```

---

## ✅ Issue 7 — Swap mode shows the player's current tiles twice (FIXED — Session 2)

`GameScreen.tsx`: single `<TileRack>` always rendered. In swap mode, its `onTilePress`, `selectedTileId`, `draggingTileId`, and `dragCallbacks` props switch automatically. The duplicate rack that was inside the `{swapMode ? ...}` block has been removed.

**Additional change:** Swap is now single-tile and immediate — tapping one tile discards it and draws a replacement instantly. No multi-select or confirm button.

---

## ✅ Issue 9 — Swap tiles non-functional after rack consolidation (FIXED — Session 2)

**Root cause:** `PanResponder` in `DraggableTile` (TileRack.tsx) is created once with `useRef`, capturing stale closures for `onTilePress`, `disabled`, and `dragCallbacks`. When swap mode activated and `onTilePress` changed to `handleSwapTileToggle`, the PanResponder still called the original no-op (`handleRackTilePress`).

**Fix:** All three props are now mirrored into refs via `useEffect`. PanResponder handlers read from `xyzRef.current` instead of the raw props.

---

## New Issues Found in Session 2

### Issue 8 — `Alert.alert` in AuthScreen (Nice to fix)

`src/screens/AuthScreen.tsx` still uses `Alert.alert` for login and register errors. On web this triggers the browser's native dialog, which can be suppressed by the user ("prevent this page from showing dialogs"). Should be replaced with inline error state matching LobbyScreen/GameScreen pattern.

**Severity:** 🟡 Medium

---

### ✅ Issue 10 — Swap crash (white screen) (FIXED — Session 2 late)

**Symptom:** Tapping a tile during swap mode caused a white screen.

**Root causes (two):**
1. `handleSwapTileToggle` had no try/catch — any exception crashed the component with no recovery.
2. Bag guard was `game.bag.length < 7` (leftover from multi-select design). With single-tile swap, only 1 tile is needed, so the guard rejected valid swaps when fewer than 7 tiles remained.

**Fix — `src/screens/GameScreen.tsx`:**
- Added try/catch/finally around both `swapSoloTiles` and `swapTiles` calls; `swapping` and `swapMode` are always reset in `finally`.

**Fix — `src/supabase/gameService.ts`:**
- `swapSoloTiles` and `swapTiles`: guard changed from `game.bag.length < 7` → `game.bag.length < tileIds.length`.

---

### ✅ Issue 11 — Self-notifications on love notes / wrong rack shown for player 2 (FIXED — Session 2 late)

**Symptom:** Sending a love note notified the sender instead of the recipient. Player 2 saw Player 1's rack on their own turn.

**Root cause — `src/screens/GameScreen.tsx`:**
```ts
// BROKEN: flips when it's opponent's turn
const currentSide = currentTurn === myUid ? 0 : 1;
```
When Player 1's turn, `currentSide = 1` for Player 2 → `partner = players[0] = Player 2 themselves` → love note sent to `myUid`.

**Fix:**
```ts
const currentSide = isSolo
  ? ((game?.moves.length ?? 0) % 2)
  : (game?.players.findIndex((p) => p.uid === myUid) ?? 0);
```
Stable index regardless of whose turn it is. Solo mode retains moves-based alternation.

---

### ✅ Issue 12 — Solo swap shows white screen after tile drawn (FIXED — Session 3)

**Symptom:** After tapping a tile in swap mode (solo), the screen flashed white instead of returning to the board.

**Root cause — `src/screens/GameScreen.tsx`:**
The `finally` block in `handleSwapTileToggle` immediately cleared `swapping` and `swapMode` after the DB write succeeded. This triggered an intermediate render with the stale pre-swap rack visible for a brief moment before the Realtime update arrived with the new rack. That flash appeared as a white screen.

**Fix:**
Applied the same `holdForRealtime` pattern used by solo move submit. On solo swap success, `soloWaitingRealtimeRef.current = true` and `holdForRealtime = true` prevent `finally` from clearing the swap UI. The Realtime callback clears `swapping`, `swapMode`, and `swapSelectedIds` together with `setGame(updatedGame)` in a single render — no intermediate state.

Multiplayer swap is unaffected (`isSolo = false` → `holdForRealtime` stays `false` → `finally` clears immediately as before).

---

### ✅ Issue 14 — White screen after board briefly shown following swap (FIXED — Session 4)

**Symptom:** After a solo swap the board appeared briefly, then went white.

**Root cause — `src/supabase/gameService.ts` `subscribeToGame`:**
Supabase Realtime `payload.new` only contains columns that were changed by the UPDATE. Swap updates `players`, `bag`, `moves`, and `updated_at` — but NOT `board`. So `payload.new.board` was `undefined`. `rowToGame(payload.new)` set `game.board = undefined`, and `BoardComponent` called `undefined.map(...)` → TypeError → React unmounted the tree → white screen.

This crash was always there but was masked in earlier sessions: when the UI was stuck at "Drawing your new tile…" (Session 3), the white screen from the board crash was hidden behind the locked swap UI. The Session 4 local-update fix made the board visible first, exposing the crash.

**Fix — `src/supabase/gameService.ts`:**
Changed `subscribeToGame` to always do a fresh `SELECT *` on RT update instead of using `payload.new` directly. A `SELECT *` always returns all columns. This mirrors the pattern already used by `subscribeToUserGames`. There is one extra network round-trip per RT event, which is fine for a turn-based game.

**Severity:** 🔴 Critical

---

### ✅ Issue 13 — Solo swap white screen still occurs after Session 3 fix (FIXED — Session 4)

**Symptom:** Tapping a tile in swap mode (solo) still causes a white screen / frozen UI even after the Session 3 fix.

**Root cause — `src/screens/GameScreen.tsx`:**
The Session 3 fix used a `holdForRealtime` mechanism: after `swapSoloTiles` succeeded, `soloWaitingRealtimeRef.current = true` kept `swapping=true` and `swapMode=true` until the Supabase Realtime update arrived with an incremented `moves.length`. If the Realtime update was delayed or the channel hiccupped, the swap state was never cleared. Because the Cancel button is disabled while `swapping=true`, the user had no escape — the UI was permanently stuck showing "Drawing your new tile…". This manifested as a white/frozen screen.

**Fix — `src/supabase/gameService.ts`:**
Modified `swapSoloTiles` to return `updatedGame` (the new `Game` object with updated players/bag/moves) alongside `{ success: true }`.

**Fix — `src/screens/GameScreen.tsx`:**
Removed `holdForRealtime` entirely from the swap path. After a successful solo swap, `setGame(result.updatedGame)` is called immediately in the try block. The `finally` block unconditionally clears `swapping`, `swapMode`, and `swapSelectedIds`. The Realtime update still arrives later and calls `setGame(updatedGame)` (harmless re-sync with identical data). The UI is never frozen — state is always cleared in `finally`.

The submit path (`handleSubmit`) still uses `holdForRealtime` / `soloWaitingRealtimeRef` unchanged.

**Severity:** 🔴 Critical (regression from Session 3 fix)

---

## Summary Table

| # | Issue | File(s) | Severity | Status |
|---|---|---|---|---|
| 1 | Tile ID collision after page reload | `src/engine/tiles.ts` | ✅ Fixed | Session 4 |
| 2 | Tile stacking on board | `BoardComponent.tsx`, `GameScreen.tsx` | ✅ Fixed | Session 2 |
| 3 | Solo mode unreliable | `GameScreen.tsx`, `gameService.ts` | ✅ Fixed | Session 2 |
| 4 | Jarring tile animation | `TileComponent.tsx` | ✅ Fixed | Session 2 |
| 5 | UI inconsistency | Multiple | 🟡 Partial | Session 2 |
| 6 | No delete game | `gameService.ts`, `LobbyScreen.tsx` | ✅ Fixed | Session 2 |
| 7 | Duplicate rack in swap mode | `GameScreen.tsx` | ✅ Fixed | Session 2 |
| 8 | Alert.alert in AuthScreen | `AuthScreen.tsx` | 🟡 Medium | Open |
| 9 | Swap broken — stale PanResponder closure | `TileRack.tsx` | ✅ Fixed | Session 2 |
| 10 | Swap white screen crash | `GameScreen.tsx`, `gameService.ts` | ✅ Fixed | Session 2 |
| 11 | Self-notifications / wrong rack | `GameScreen.tsx` | ✅ Fixed | Session 2 |
| 12 | Solo swap white screen (stale intermediate render) | `GameScreen.tsx` | ✅ Fixed | Session 3 |
| 13 | Solo swap white screen still occurs (UI stuck) | `GameScreen.tsx`, `gameService.ts` | ✅ Fixed | Session 4 |
| 14 | White screen after board shown (RT payload missing board) | `gameService.ts` | ✅ Fixed | Session 4 |
| 15 | passTurn not recording a move | `gameService.ts` | ✅ Fixed | Session 5 |
| 16 | submitSoloMove stored displayName as move uid | `gameService.ts` | ✅ Fixed | Session 5 |
| 17 | Biased shuffle in swapTiles / swapSoloTiles | `gameService.ts` | ✅ Fixed | Session 5 |
| 18 | sendLoveNote notified on DB failure | `gameService.ts` | ✅ Fixed | Session 5 |
| 19 | No scrolling on web game screen | `GameScreen.tsx` | ✅ Fixed | Session 5 |
| 20 | Tiles unplaceable on web (drag-only, no mouse fallback) | `GameScreen.tsx`, `BoardComponent.tsx` | ✅ Fixed | Session 5 |
| 21 | Board zoomed in on desktop / wrong on resize | `BoardComponent.tsx`, `GameScreen.tsx` | ✅ Fixed | Session 6 |
| 22 | Submit spinner stuck in solo (race: realtime fired before ref set) | `GameScreen.tsx` | ✅ Fixed | Session 6 |
| 23 | Drag unreliable / multi-click required (PanResponder latency) | `TileRack.tsx`, `BoardComponent.tsx` | ✅ Fixed | Session 6 |
| 24 | Bonus colors disappear when tile is selected | `BoardComponent.tsx` | ✅ Fixed | Session 6 |
| 25 | Blank tile doesn't show assigned letter | `TileComponent.tsx` | ✅ Fixed | Session 6 |
| 26 | Swap immediately ends turn — needs multi-select + confirm | `GameScreen.tsx`, `TileRack.tsx` | ✅ Fixed | Session 6 |
| 27 | Submit button requires scrolling on shorter windows | `GameScreen.tsx` | ✅ Fixed | Session 6 |
| 28 | Tile distribution hybrid (Scrabble counts + WWF values) felt punishing | `engine/tiles.ts` | ✅ Fixed | Session 6 |
| 29 | Lost tile dragging pending tile from board (rare) | `GameScreen.tsx` | 🟠 Mitigated | Session 6 — defensive logging added; root cause not yet reproduced |
| 30 | Supabase anon key split across two lines — build syntax error | `src/supabase/config.ts` | ✅ Fixed | Session 7 |
| 31 | No Home Screen icon / not installable as a PWA | `assets/logo/`, `public/manifest.json`, `scripts/` | ✅ Added | Session 7 |
| 32 | No notification badge on Home Screen icon | `public/sw.js`, `src/utils/appBadge.ts`, `App.tsx` | ✅ Added | Session 7 |

---

## Related files for full context

- `AGENT_HANDOFF.md` — full architecture, schema, credentials, deployment
- `RELEASE_NOTES.md` — changelog by session
- `src/screens/GameScreen.tsx` — main game logic (~820 lines)
- `src/supabase/gameService.ts` — all Supabase read/write functions
- `src/engine/tiles.ts` — tile bag creation and drawing
- `src/components/BoardComponent.tsx` — 15×15 board rendering
- `src/components/TileComponent.tsx` — single tile rendering + selection style
- `src/components/TileRack.tsx` — rack container + drag-and-drop handlers
- `src/screens/LobbyScreen.tsx` — game list + create/join/delete
- `src/screens/AuthScreen.tsx` — login/register (**Issue 8 fix needed here**)
- `src/utils/colors.ts` — design tokens (LIGHT pink theme, NOT dark)
