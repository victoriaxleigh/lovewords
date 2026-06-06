# LoveWords — Release Notes

---

## Session 6 — 2026-06-05

### Tile distribution

**Switched from Scrabble-counts/WWF-values hybrid to pure WWF distribution (100 → 104 tiles).** The previous bag was Scrabble distribution with WWF point values — fewer S/T/H/D combined with high penalty values on rough letters made racks feel punishing. Pure WWF gives more common letters (E 12→13, T 6→7, S 4→5, H 2→4, D 4→5; I 9→8, N 6→5) so racks build words more easily; WWF values (V=5, J/Z=10, B/C/F/M=4) preserve the upside on rare tiles. Initial bag count after dealing is now 90 (was 86). Updated tile + swap engine tests.

### Drag/drop rewrite

**Replaced PanResponder with native pointer events in `TileRack` and `BoardComponent`'s `DraggablePendingTile`.** The PanResponder model added responder negotiation latency, lost gestures to ancestor `ScrollView`s, and required mounting-time closures that grew stale. The new implementation attaches `pointerdown` / `pointermove` / `pointerup` / `pointercancel` listeners directly to the wrapper `View`'s DOM node via `useEffect` + `ref`, uses `setPointerCapture` to lock the gesture to the source element until release, and sets `touch-action: none` on the wrapper so mobile browsers don't try to scroll/zoom mid-drag. 5px movement threshold distinguishes tap from drag. The same code path covers mouse, touch, and pen — important for the planned PWA on mobile.

### Game-screen layout

**Board cell size now adapts to viewport.** Replaced module-load `Dimensions.get('window').width` with `useWindowDimensions()` inside `BoardComponent`. Cells are capped at 36px and additionally constrained by available height (`(windowHeight - 320) / 15`) so the board never overlaps the pinned bottom bar. `GameScreen` uses a new `getCellSize()` helper for drag-end coordinate math so resizes are picked up live.

**Rack + action row pinned outside `ScrollView`.** The submit button used to require scrolling on shorter windows. The rack and action buttons now sit in a `bottomBar` view below the `ScrollView`; only the board area scrolls if anything overflows. Submit is always reachable.

**Empty cells keep their bonus color when a tile is selected.** Previously `canPlace` flipped every empty cell to dark maroon, hiding the TW/DW/TL/DL markers exactly when the player most needed them. The cell-highlight border was also removed — it lit up every empty cell uniformly, which carried no information.

### Bug fixes

**Submit spinner stuck in solo mode**
`handleSubmit` set `soloWaitingRealtimeRef.current = true` *after* awaiting `submitSoloMove`, but the realtime callback (firing from inside the mock or via Supabase websocket) could resolve `fetchGame → onUpdate` *before* the await returned. The callback then checked the ref, saw `false`, and skipped clearing `submitting` — and no further realtime events ever fired, so the spinner ran forever. Fixed by setting the ref *before* the await; cleared on failure paths.

**Blank tile didn't render its assigned letter**
`TileComponent` rendered `tile.isBlank ? '★' : tile.letter`, so a blank that had been assigned a letter via the picker still showed ★ on the board. Now renders `tile.letter || '★'` (showing the assigned letter in italic so it's still distinguishable as a blank), and the accessibility label says "Blank tile set to X".

### Swap UX

**Multi-select swap with confirm and new-tile highlight.** The previous behaviour was single-tile-immediate (tap a tile in swap mode → instant swap), which surprised players who expected to mark multiple tiles for swap. Reworked into a two-step flow: tap rack tiles in swap mode to toggle them in `swapSelectedIds` (visible selection highlight), then a **Confirm (N)** button commits all selected tiles in a single `swapSoloTiles` / `swapTiles` call. Cancel still backs out.

Newly drawn tiles (after a swap *or* a submit-draw) flash with a gold border via the existing `highlight` prop on `TileComponent`. Detection is a `useEffect` that diffs the rack's tile IDs against the previous render via a ref; new IDs get added to `recentlyDrawnIds: Set<string>` for 2.2s. Solo mode suppresses the flash on side flips (after a move the rack switches to the other player's tiles, which would otherwise all read as "newly drawn").

### Dev tooling

**In-memory mock Supabase client (`?dev=1`, dev builds only).** Added `src/supabase/mockClient.ts` — a self-contained mock of the Supabase JS API surface used by the app (`auth`, `from().insert/select/update/delete/eq/or/order/single`, `channel().on().subscribe()`, `removeChannel`). `src/supabase/config.ts` swaps the real client for this mock when `?dev=1` is in the URL **and** `__DEV__` is true; the mock is `require()`d inside the `__DEV__` branch so Metro tree-shakes the entire module out of production builds (`npx expo export`). Auto-signs you in as `dev@local` and keeps games, profiles, and love notes in tab-local memory. Lets a dev exercise the UI without hitting real Supabase, without creating throwaway accounts, and without dealing with email-confirmation rate limits.

### Defensive checks

`handleDragEnd` now treats non-finite (`NaN`/`Infinity`) row/col as off-board and removes the tile from `pendingTiles` (treating it like a return-to-rack); logs `[lovewords] drag drop with bad coords` if it happens. A new `useEffect` in `GameScreen` watches `pendingTiles` and warns `[lovewords] ghost pending tiles detected` if any entry has out-of-range coordinates — meant to catch a reproducible-but-unexplained "lost letter" report where a placed tile vanished from both board and rack. Recall recovers it; defensive logging will help pin the source next time it happens.

### Tests

All 65 engine tests pass against the new bag size and distribution. Updated count assertions in `tiles.test.ts` (E count, total = 104, draw remainders, exchange remainders) and `swap.test.ts` (bag remainder).

---

## Session 5 — 2026-05-15

### New Features

**Last played word gold highlight**
Tiles from the most recently committed word move now glow gold on the board — amber border (`#FFB300`, 2px), gold shadow (`shadowColor: '#FFB300'`, opacity 0.9, radius 6). Implemented via a new `highlight` prop on `TileComponent`. `GameScreen` computes `lastMoveTiles` (a `Set<string>` of `"row,col"` keys from the last non-empty move) via `useMemo` on `game.moves`, and passes it through `BoardComponent` to each committed `TileComponent`.

**Click-to-place fallback for web**
Tiles can now be placed by tapping as well as dragging, making the game fully playable in a desktop browser. Tap a rack tile to select it (tap again to deselect), then tap any open board cell to place it. Tap a placed tile to return it to your rack. Drag still works everywhere and is the primary interaction on mobile. The 8px movement threshold still distinguishes tap from drag in `DraggablePendingTile` — on drag ≥8px, the tile floats; on tap <8px, `onTilePress` fires. Rack taps in normal mode now call `setSelectedTile` instead of being a no-op.

**Web scrolling**
The game screen is now scrollable on web. Wrapped the content (header through action buttons) in a `ScrollView`. The floating drag tile and modals sit outside the `ScrollView` so they stay screen-fixed. Board position measurement uses `boardRef.current?.measure()` on each drag start, which returns current page coordinates and is scroll-aware.

### Bug Fixes

**`passTurn` was not recording a move**
`passTurn` flipped `current_turn` but never appended anything to `moves`. This meant pass turns were invisible in game history, and the `lastMoveTiles` logic would incorrectly highlight the previous word again after a pass. Fixed: now appends `{ uid: playerUid, tiles: [], score: 0, timestamp: Date.now() }` to moves (matching `passSoloTurn`). Also added a turn guard: throws if `game.currentTurn !== playerUid`.

**`submitSoloMove` stored `displayName` as move uid**
`Move.uid` was set to `game.players[playerIndex].displayName` instead of `.uid`. Fixed.

**Biased shuffle in `swapTiles` and `swapSoloTiles`**
Both used `.sort(() => Math.random() - 0.5)` which is statistically biased. Replaced with `shuffle()` (Fisher-Yates, already exported from `tiles.ts` and used everywhere else). `swapTiles` also gained a turn guard matching the other multiplayer functions.

**`sendLoveNote` sent push notifications even on DB insert failure**
`sendLoveNote` called `sendPushNotification` unconditionally. Fixed to check the Supabase insert result and only notify on success. Return type changed to `Promise<{ success: boolean; error?: string }>`. `LoveNotesModal.handleSend` now shows an inline error on failure.

### Accessibility (WCAG 2.1 AA)

Full accessibility pass across all screens:

- **Contrast fixes**: `Colors.primary (#E91E8C)` replaced with `Colors.primaryDark (#B5006E)` for all text-role uses (6.58:1 on white vs 4.17:1). Applies to: back button, sign-out, auth switch link, solo button text, love notes button. DL bonus squares changed from white text (2.2:1 on light blue) to dark ink `rgba(45,10,30,0.85)` (8:1). Love note timestamp opacity raised from 0.6 to 0.85.
- **Labels**: `accessibilityLabel` + `accessibilityRole` added to all interactive elements: back button, love notes button, error dismiss, modal close, all TextInputs (display name, email, password, invite email, note message). ScoreBoard player cards announce name, score, and turn state. Bag count announces remaining tiles.
- **Hints**: Game cards have `accessibilityHint="Long press to delete this game"`.

### Tests

Unit test suite not re-run this session. Changes touched `gameService.ts` (shuffle, passTurn, sendLoveNote, submitSoloMove) — recommend running `npx jest` before Session 6. Engine files (`board.ts`, `scoring.ts`, `tiles.ts`, `dictionary.ts`) were not changed.

---

## Session 4 — 2026-05-13

### New Features

**Drag placed tiles to reposition them on the board**
Previously, tapping a placed (pending) tile was the only way to return it to the rack, and repositioning required recalling and re-dragging from the rack. Now you can drag a tile that's already on the board directly to a new cell. Touching and moving ≥ 8px starts a drag: the tile is pulled out of its cell and becomes the floating tile, then lands on the new cell when released. A short tap (< 8px) still returns the tile to the rack. Dropping off-board or onto an occupied cell also returns it to the rack. Implemented via `DraggablePendingTile` in `BoardComponent.tsx` (same PanResponder pattern as `DraggableTile` in `TileRack.tsx`) and `handleBoardTileDragStart` in `GameScreen.tsx`.

### Bug Fixes

**Tile ID collision after page reload**
After a page reload, `tiles.ts` restarted its module-level counter from 0, producing IDs like `tile_0`, `tile_1`, etc. that collided with IDs already stored in Supabase. The rack filter (`rack.filter(t => !usedIds.has(t.id))`) then silently dropped tiles that were never played, corrupting the rack. Fixed by removing the counter entirely and replacing it with `crypto.randomUUID()`. No polyfill is needed — `crypto.randomUUID()` is a native browser API available in all modern browsers and is covered by the project's existing `"lib": ["DOM", "ESNext"]` TypeScript config.

**White screen after board shown on swap (Realtime payload missing board column)**
Supabase Realtime `payload.new` only includes columns changed by the UPDATE query. Swap updates `players`, `bag`, `moves`, and `updated_at` — not `board`. So `payload.new.board` was `undefined`, which caused `BoardComponent` to crash on `undefined.map(...)`. Previously masked by the locked swap UI (the crash happened behind "Drawing your new tile…"), the Session 4 local-update fix made the board visible first, exposing the crash. Fixed by changing `subscribeToGame` to always do a fresh `SELECT *` on RT events instead of using `payload.new` directly — guaranteeing all columns are present. Mirrors the pattern already used by `subscribeToUserGames`.

**Solo swap: UI permanently frozen after tile draw (regression from Session 3)**
The Session 3 fix introduced a `holdForRealtime` mechanism that kept the swap UI locked (`swapping=true`, Cancel disabled) until Supabase Realtime confirmed the move by incrementing `moves.length`. If the Realtime update was delayed or the channel dropped, the state was never cleared and the user was permanently stuck — no way to cancel or interact. Fixed by removing `holdForRealtime` from the swap path entirely. `swapSoloTiles` now returns the computed `updatedGame` object; on success, `setGame(result.updatedGame)` is called immediately in the try block, and `finally` unconditionally clears all swap state. The Realtime update still arrives later as a harmless re-sync.

### Tests

Unit test suite not re-run this session. All Session 2 tests (65 passing) remain valid; the Session 4 changes touched `tiles.ts` (ID generation only — no logic change) and `gameService.ts`/`GameScreen.tsx` (swap path). Recommend running `npx jest` at the start of Session 5.

---

## Session 3 — 2026-05-13

### Bug Fixes

**Solo swap: white screen after tile drawn**
After a solo swap succeeded, the `finally` block immediately cleared `swapping` and `swapMode`, causing a brief intermediate render with the stale pre-swap rack before the Realtime update arrived. This flash appeared as a white screen. Fixed by applying the same `holdForRealtime` pattern already used for solo move submit: `soloWaitingRealtimeRef.current` is set to `true` on success, keeping the "Drawing your new tile…" UI locked until the Realtime callback fires and atomically clears the swap state together with the new game data. Multiplayer swap is unaffected (immediately clears as before).

---

## Session 2 — 2026-05-12

### New Features

**Delete a game**
Long-press any game card in the lobby to delete it. An inline confirmation appears — tap Delete to confirm or Cancel to dismiss. Requires the Supabase RLS delete policy (see Setup Notes below).

**Drag-only tile placement**
Tiles can only be placed on the board by dragging. Tapping a tile in the rack no longer selects it or highlights the board. This makes the interface cleaner and avoids accidental placements.

**Simplified tile swap**
Swap mode is now single-tile and immediate: tap Swap, then tap any one tile in your rack — it's instantly discarded and replaced with a random tile from the bag. No multi-select, no confirm button.

### Bug Fixes

**Solo mode: no more spurious state resets on game open**
Opening an existing solo game mid-play no longer wipes your pending tiles. The turn-flip detection now correctly ignores the initial game load.

**Solo mode: UI locked between move submit and Realtime update**
After submitting a solo move the board and rack are locked until Supabase confirms the new rack has arrived, preventing tiles from being placed against a stale rack.

**Tile stacking on board (drag)**
Dragging a tile onto a cell already occupied by a pending tile now correctly does nothing (stale closure fixed with functional state updater).

**Tile stacking on board (tap)**
The outer cell `TouchableOpacity` is now disabled when a pending tile sits on that cell, so tapping the tile to recall it no longer also fires the cell press.

**Duplicate rack in swap mode**
Previously two identical racks appeared when swap mode was active. Now a single rack is rendered at all times; its press behaviour switches based on mode.

**Tile selection animation**
Removed the `translateY` jump that caused layout shift in the rack when a tile was selected. Selection is now shown with a thicker border and subtle scale (1.08×) only — no position shift.

**Inline errors in Lobby**
`Alert.alert` removed from LobbyScreen. Invite errors, solo start errors, and delete errors now appear as dismissible inline banners matching the GameScreen style.

**UUID error in solo mode**
Old solo games created before the uuid-safe rewrite had invalid non-UUID values stored in `current_turn`. These have been deleted from Supabase. New solo games are not affected.

### Bug Fixes (late session)

**Swap tiles broken after rack consolidation**
When the duplicate swap-mode rack was removed, the single `TileRack`'s `PanResponder` (created once with `useRef`) held stale closures for `onTilePress`, `disabled`, and `dragCallbacks`. Tapping a tile in swap mode called the old no-op instead of `handleSwapTileToggle`. Fixed by keeping all three as refs updated via `useEffect` so the PanResponder always invokes the current callbacks.

**Swap white screen crash**
`handleSwapTileToggle` had no error boundary — any exception from `swapSoloTiles`/`swapTiles` propagated and crashed the component. Also, the bag guard was `bag.length < 7` (left over from a prior multi-select design), so single-tile swaps failed when fewer than 7 tiles remained. Fixed: guard changed to `< tileIds.length`; try/catch/finally added so `swapping` and `swapMode` are always reset even on error.

**Self-notifications on love notes / wrong rack shown**
`currentSide` was computed as `currentTurn === myUid ? 0 : 1` — a turn-based flip. When it was the opponent's turn, `currentSide` flipped to 1, making `partner = players[0] = myself`. Love notes were addressed to `partnerUid = myUid` (self-notification). Player 2's rack was also shown to themselves on Player 1's turn. Fixed: `currentSide = players.findIndex(p => p.uid === myUid)` — stable regardless of whose turn it is. Solo mode retains `moves.length % 2`.

### Tests
65 unit tests passing across `board`, `scoring`, `tiles`, `swap`, and `dictionary` suites.

### Setup Notes (one-time, Supabase dashboard)

Run this in the SQL Editor to enable in-app game deletion:

```sql
CREATE POLICY "Players can delete their games"
ON games FOR DELETE
USING (player1_uid = auth.uid() OR player2_uid = auth.uid());
```

---

## Session 1 — (prior agent)

- Solo mode complete rewrite — `current_turn` never changes; active side tracked by `moves.length % 2`
- New gameService functions: `submitSoloMove`, `passSoloTurn`, `swapSoloTiles`
- Solo practice button in lobby
- Drag-and-drop tile placement with `PanResponder`
- Live score preview on Submit button (`+X pts`)
- Inline submit error/success banners (replaced all `Alert.alert` in GameScreen)
- Pass confirm UI (inline, no Alert)
- Blank tile letter picker modal
- ScoreBoard fixed for solo mode (index-based, not uid-based)
- Love Notes rewrite: `FlatList inverted`, horizontal quick-chip FlatList, `KeyboardAvoidingView`
- Smack talk modal (losing by >10 pts, non-solo only)
