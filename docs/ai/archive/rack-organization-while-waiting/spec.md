---
feature: rack-organization-while-waiting
status: complete
created: 2026-07-27
updated: 2026-07-27
iteration: 3
---

## Overview

Let players organize their own rack even while an opponent is taking a turn. Rack order is a
local presentation preference: organizing tiles must remain responsive without changing the
shared game, advancing the turn, or enabling board play while the player is waiting.

## Requirements

- [x] A player can reorder visible rack tiles with a horizontal drag while the game is active,
  including when it is not their turn.
- [x] A vertical tile drag continues to place a tile on the board only during the player's turn;
  taps and board placement remain disabled while waiting.
- [x] Rack reordering and the existing shuffle control update local display order only and do not
  call a game service or mutate shared game state.
- [x] The chosen order is preserved for surviving tile IDs across realtime game refreshes, with
  newly drawn tiles appended and stale tile IDs ignored.
- [x] Empty and one-tile racks remain safe no-ops.

## Technical Design

Add pure rack-order helpers under `src/engine/` to apply a saved ID order to the current rack and
move a tile ID to a clamped target index. Use them from `GameScreen.tsx` so realtime `Game` updates
continue to reconcile against local order rather than overwriting it.

Extend the existing `DraggableTile` gesture in `src/components/TileRack.tsx` with a small direction
lock after the current drag threshold. A horizontal gesture invokes a rack-reorder callback using
the tile's index and horizontal translation. A vertical gesture follows the existing board-drag
callback only when gameplay is enabled. When gameplay is disabled but rack organization is
enabled, horizontal gestures still run while taps and vertical gestures remain inert. Keep the
existing ref pattern because the gesture object is memoized once.

Wire rack organization from `GameScreen.tsx` for active games. Reordering the currently visible
rack should retain hidden pending tile IDs after the visible IDs so recalling a tile cannot lose
it. Do not add persistence, database fields, service calls, dependencies, or unrelated rack
sorting modes.

Add focused Jest coverage for ordering, moves in both directions, index clamping, new/stale IDs,
and no-op inputs. Run the full Jest suite and production web build.

## Acceptance Criteria

- [x] During an opponent's turn, dragging a rack tile horizontally changes its position and the
  new order survives an incoming realtime refresh containing the same rack.
- [x] During an opponent's turn, tapping a rack tile or dragging it toward the board cannot select
  or place it.
- [x] During the player's turn, horizontal rack organization and vertical board placement both
  work without changing submit, swap, pass, or recall behavior.
- [x] A newly drawn tile appears after the player's retained custom order.
- [x] The full test suite and production web build pass.

## Findings

### Implementation Blockers

### QA

- [x] [iter 1] Add automated coverage for `TileRack` gesture and turn gating: current tests only
  exercise the pure rack-order helpers, leaving horizontal reordering while waiting, inert
  taps/vertical drags while waiting, and horizontal reordering plus vertical board placement
  during the player's turn unverified.

### Security

### User Notes

- [x] Rack reordering needs live visual feedback while dragging; the tile currently appears
  stationary and only jumps to its new position after release.
- [x] Drag intent should be reversible within one gesture: dragging upward and then returning to
  the rack must switch back from board-placement mode to horizontal reorder mode.

## Pipeline Log

- [iter 1] implement: complete — Added local rack ordering with turn-aware horizontal/vertical gesture locking and realtime order reconciliation; 145 tests and the production web build pass.
- [iter 1] qa: complete — One finding: add automated coverage for the acceptance-critical gesture direction and turn gating; 145 tests, the web build, and diff checks pass with no new type errors.
- [iter 1] security: complete — No exploitable issues found; changes are limited to local rack-order state and turn-gated gestures.
- [iter 2] implement: complete — Added focused gesture direction/turn-gating helpers and six tests, resolving the iteration-1 QA finding; 151 tests and the production web build pass.
- [iter 2] qa: complete — Clean pass; the gesture coverage finding is resolved, and 151 tests, the production web build, and diff checks pass with no feature-related type errors.
- [iter 2] security: complete — No exploitable issues found; local-only rack ordering and explicit gameplay turn gating remain intact.
- [iter 3] implement: complete — Added live horizontal pointer tracking plus lift/scale styling while reordering; 152 tests and the production web build pass.
- [iter 3] qa: complete — Clean pass; live feedback and reset/cancel behavior work without regressing vertical board dragging or waiting-turn gating; 152 tests and the web build pass.
- [iter 3] security: complete — No exploitable issues found; feedback remains local visual state and does not alter service or turn boundaries.

## Outcome

Players can reorder their rack during either player's turn with the dragged tile following the
pointer and lifting visually until release. Drag intent can switch between board placement and
rack reordering within one gesture; the order stays local and realtime-safe while turn gating
remains intact.
