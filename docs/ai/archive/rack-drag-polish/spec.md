---
feature: rack-drag-polish
status: complete
created: 2026-07-28
updated: 2026-07-28
iteration: 1
---

## Overview

Make rack dragging feel like one continuous pickup instead of two competing gestures. A lifted tile
should visibly preview its rack insertion slot, transition naturally into board placement when
moved upward, and return to rack organization without the interaction flickering between modes.

## Requirements

- [x] A rack drag lifts immediately after the existing movement threshold and keeps the tile under
  the pointer while it remains in rack-organization mode.
- [x] Crossing rack slots previews the insertion point by shifting the neighboring tiles before
  release; releasing commits the previewed order.
- [x] During the player's turn, moving a lifted tile upward transitions to the existing board-drag
  flow, and moving it back to the rack transitions back to reorder mode within the same gesture.
- [x] The rack/board transition uses separate enter and exit thresholds so diagonal or slightly
  shaky movement does not rapidly switch modes.
- [x] While waiting for the opponent, rack reordering remains available but taps and board
  placement remain disabled.
- [x] Cancelling or interrupting a drag clears all preview and floating-tile state without changing
  rack order or shared game state.

## Technical Design

Replace dominant-axis intent detection in `src/components/tileRackGesture.ts` with pure helpers for
a destination-oriented rack/board mode using vertical displacement and hysteresis. Keep the
existing movement threshold and target-index calculation, and add a pure helper that calculates
which sibling tiles shift to expose the candidate insertion slot.

In `src/components/TileRack.tsx`, keep the existing per-tile gesture and ref pattern, but lift the
dragged tile for the full gesture. Store only the active source/target preview in `TileRack`; use it
to animate neighboring tiles by one stride as the pointer crosses slot midpoints. Start the
existing `GameScreen` board-drag callbacks only when the gesture enters board mode, cancel them
when it returns to rack mode, and decide the release action from the current mode. Gameplay
availability must require actual drag callbacks so swap mode cannot accidentally enter board
placement.

Do not change rack persistence, board coordinate validation, game services, dependencies, or
unrelated controls. Add focused Jest coverage for mode hysteresis, release routing, target
selection, and sibling preview offsets. Run the full Jest suite and production web build.

## Acceptance Criteria

- [x] Dragging a tile across two rack positions visibly opens the target slot before release and
  commits the tile there on release.
- [x] A tile can move rack → board → rack in one gesture without a rapid mode flip near the
  boundary, then be either reordered or placed according to its final destination.
- [x] A waiting player can reorder with the same preview but cannot select or place a tile.
- [x] A cancelled gesture restores the rack visuals and clears any floating board tile.
- [x] The full test suite and production web build pass.

## Findings

### Implementation Blockers

### QA

### Security

### User Notes

## Pipeline Log

- [iter 1] implement: complete — Added continuous pickup, live insertion previews, rack/board hysteresis, safe release routing, and cancellation cleanup; 155 tests and the production web build pass.
- [iter 1] qa: complete — Clean review with no findings; 155 tests and the production web build pass, while `tsc --noEmit` retains four pre-existing errors in unchanged files.
- [iter 1] security: complete — No exploitable issues found; the change remains local UI state with existing turn and board-drop gates intact.

## Outcome

Rack tiles now behave as one continuous pickup: neighboring tiles preview the insertion slot while
the drag stays near the rack, and moving upward transitions into existing board placement. Sticky
rack/board thresholds keep the interaction stable, with no database, service, or shared-state
changes.
