---
feature: versioned-game-history
status: complete
created: 2026-07-23
updated: 2026-07-23
iteration: 3
---

## Overview

Record versioned, analysis-quality turn events for newly played LoveWords games and expose them
through the existing finished-game analysis endpoint. The event stream remains compact, supports
deterministic board reconstruction without stored snapshots, and remains compatible with legacy
move records already present in Supabase.

## Requirements

- [x] New plays record event version, action, player index, rack before the turn, placements,
  formed words with their scores, total score, resulting player score, drawn tiles, remaining bag
  count, and timestamp.
- [x] New swaps record event version, action, player index, rack before the turn, returned tiles,
  drawn tiles, remaining bag count, and timestamp in both multiplayer and solo games.
- [x] New passes record event version, action, player index, rack before the turn, remaining bag
  count, and timestamp in both multiplayer and solo games.
- [x] Recorded rack/draw/return tiles use a compact analysis representation without raw tile IDs.
- [x] Consecutive-pass detection, solo turn alternation, latest-play highlighting, and first-board-
  play detection work with both legacy moves and version-2 events.
- [x] A pure replay utility reconstructs the board after any requested event from the empty board
  and play placements without storing per-turn board snapshots.
- [x] The analysis export maps version-2 events to stable player aliases and includes rich event
  fields, board/rules metadata, and a `full` versus `basic` recording-quality indicator.
- [x] Finished legacy and mixed-history games remain exportable without fabricating data that was
  never recorded.
- [x] Public turn history remains in `games.moves`, while analysis-only rack/draw/return fields are
  captured atomically in a server-private table that clients cannot select directly; the existing
  analysis-token and export URLs remain unchanged.

## Technical Design

Extend `Move` in `src/types/index.ts` with optional version-2 analysis fields while retaining the
legacy common fields consumed by the UI. Add a compact `RecordedTile` type and export the scored-word
shape from `src/engine/scoring.ts`.

Create `src/engine/gameHistory.ts` with pure builders for play, swap, and pass events; compatibility
helpers for deriving action/player identity from legacy or version-2 moves; and deterministic board
replay using `createEmptyBoard` and `applyMoveToBoard`. Centralizing event construction prevents the
solo and multiplayer service paths from drifting.

Update every submit/swap/pass path in `src/supabase/gameService.ts` to append a version-2 event.
Multiplayer swaps currently do not append any move and must begin doing so. Keep old rows readable.
Update `GameScreen.tsx` compatibility checks so passes use the derived action and the first required
board play is based on the absence of prior placements rather than `moves.length`.

Add an idempotent `game_analysis_events` table and trigger to `supabase_schema.sql`, plus a
standalone timestamped migration that can be safely run and rerun against the deployed schema. The
trigger atomically captures each newly appended full version-2 event, then strips `rackBefore`,
`drawnTiles`, and `returnedTiles` from the participant-readable `games.moves` copy. No client role
can select or mutate captured events; the service-role export function reads them only after
validating a capability token. Mark newly created games with history-version provenance inside
their existing `players` JSON so pre-upgrade games can never be misclassified as fully recorded
without adding a column to `games`.

Enhance `sanitizeGameExport` in `netlify/functions/game-analysis-common.js` without changing routes
or token semantics. Fetch captured analysis events only after the scoped game is confirmed finished.
Keep the top-level payload versioned, mark an export `full` only when the game has complete-from-
creation provenance and every public event has a matching complete private event, retain
null/omitted fields for legacy gaps, and add compact static board metadata sufficient to interpret
coordinates and bonus squares. Do not include the stored board or any per-turn board snapshot.

Add engine tests for builders, compatibility behavior, compact tiles, pass/swap recording semantics,
and replay at intermediate turns. Extend export and handler tests for rich events, legacy fallback,
sanitization, and board metadata. Run the full Jest suite, production web export, Netlify function
syntax checks, and diff checks.

## Acceptance Criteria

- [x] A newly completed game export contains enough recorded information to reconstruct every board
  position and every player's known rack before each turn.
- [x] A seven-tile play preserves per-word scores, total score, and the bingo-inclusive result.
- [x] Multiplayer swaps appear in history and advance the turn exactly once.
- [x] Four consecutive version-2 passes finish a game just as four legacy pass records do.
- [x] Replaying through event `N` produces only placements from plays at or before `N`; swaps and
  passes never mutate the board.
- [x] Legacy exports remain valid, are marked `basic`, and do not claim unavailable racks, draws,
  returned tiles, words, or player identities.
- [x] The full test suite and production web build pass without new type errors.

## Findings

### Implementation Blockers

### QA

- [x] [iter 1] Persist provenance that distinguishes games recorded completely under version 2, and require it for `recordingQuality: full`. A pre-v2 multiplayer game can contain unrecorded swaps; if its first visible post-upgrade event is version 2, the current `sourceMoves.every(isCompleteV2Event)` check incorrectly labels the incomplete history `full` (for example, a first recorded event by player 2 after player 1 made a legacy unrecorded swap). Add a regression test for this upgrade scenario and conservatively classify histories without complete-from-creation provenance as `basic`.
- [x] [iter 1] Revert the seven unrelated generated PNG changes under `assets/` and `public/`, or move an intentional icon regeneration into a separate change. No icon source changed, yet every tracked output has different pixels after the build, so committing them would introduce visual asset churn outside this feature.
- [x] [iter 2] Provide and document a standalone, executable, idempotent migration for `game_analysis_events`, then test it against an already-initialized PostgreSQL schema and rerun it. The only migration artifact is embedded in `supabase_schema.sql`, whose header instructs running the whole file, but existing `CREATE POLICY` and `ALTER PUBLICATION ... ADD TABLE` statements are not rerunnable and will fail on the deployed schema. `SETUP.md` also never instructs operators to apply the new SQL, so deployment can silently remain on the rolling `basic` fallback while clients continue writing hidden fields into `games.moves`.
- [x] [iter 2] Base finished-only private-event access on server-controlled completion, or otherwise prevent participants from changing the authorization predicate. The existing `games_update` policy lets either participant update any game column, including `status`; a caller can set an active game to `finished`, satisfy `finished_game_analysis_events_read`, read the private history (and mint an analysis token), then change the status back. Add a database-level regression test proving an authenticated participant cannot expose analysis events before a legitimate completion.

### Security

- [x] [iter 1] Version-2 `rackBefore`, `drawnTiles`, and `returnedTiles` are stored in the participant-readable `games.moves` JSONB column; any authenticated opponent can query the active game row directly and inspect this hidden tile history before the game finishes, bypassing the export endpoint’s finished-game restriction. Store hidden analysis history behind server-only access until completion, or expose active games through a player-filtered server API/view that omits opponents’ racks, bag contents, and analysis-only events. — severity (medium)
- [x] [iter 2] The `game_analysis_events` RLS policy and both export endpoints trust `games.status = 'finished'`, but the existing `games_update` policy allows either participant to update every game column, including `status`. An opponent can PATCH an active game to `finished`, immediately SELECT the private rack/draw/return events or mint an analysis token and export them, then restore `active`. Make completion state server-authoritative—restrict direct status updates and transition it through a validated server function/trigger—or otherwise base private-event access on a condition participants cannot forge. — severity (medium)

### User Notes

- [x] [iter 2] Accepted threat-model limitation: LoveWords is currently client-authoritative and a
  determined participant can already rewrite the game row, including racks, bag, moves, and status.
  Per the user's stated casual-game risk tolerance, this feature will make captured analysis events
  backend-only and track server-authoritative game commits as a separate future hardening project
  instead of expanding this feature into a gameplay-backend rewrite.

## Pipeline Log

- [iter 1] implement: complete — Added compact version-2 play/swap/pass events, legacy compatibility helpers, deterministic replay, rich full/basic exports, and service/engine/export coverage; 116 tests and the production web build pass.
- [iter 1] qa: complete — Two findings: add complete-from-creation provenance before claiming full quality, and remove unrelated generated PNG churn; all 116 tests and build checks pass.
- [iter 1] security: complete — One medium finding: analysis-only rack/draw/return history must not remain readable by opponents during active games.
- [iter 2] implement: complete — Added atomic private event capture/scrubbing, finished-only RLS, immutable creation provenance, migration backfill, endpoint merging/fallback, regression coverage, and removed unrelated generated PNG changes; 126 tests and the web build pass.
- [iter 2] qa: complete — Provenance, merge/fallback, tests, and worktree scope pass; findings require a standalone rerunnable migration and identify the participant-mutable completion predicate.
- [iter 2] security: complete — One medium finding: the existing client-authoritative game row lets a participant forge completion and unlock the endpoint.
- [iter 3] implement: complete — Added and documented a standalone transactional/rerunnable migration, made captured events service-role-only, tracked the accepted client-authoritative limitation as Issue 33, and verified migration/backfill/trigger/RLS behavior against PostgreSQL 16 twice; 129 tests and the web build pass.
- [iter 3] qa: complete — Clean pass; 129 tests, repeat PostgreSQL 16 migration/behavior checks, function syntax, web export, and scoped diff checks pass with no new findings.
- [iter 3] security: complete — No new exploitable issues within the documented threat model; private events and trigger privileges are restricted and endpoint access remains capability-scoped.

## Outcome

Completed on 2026-07-23.

- Added compact version-2 play, swap, and pass events with enough information to replay the board
  and analyze known racks without storing board snapshots.
- Added immutable complete-from-creation provenance and conservative `full` versus `basic` export
  quality so legacy games never claim history that was not recorded.
- Added an idempotent migration and atomic trigger that move analysis-only rack, draw, and return
  data into a service-role-only table while retaining public turn history.
- Kept the existing analysis URLs and capability-token flow stable while enriching new-game exports.
- Verified 129 tests, a production web build, Netlify function syntax, and two consecutive
  PostgreSQL 16 migration/behavior runs.
- Follow-up: Issue 33 tracks server-authoritative game commits. The current client-authoritative
  completion predicate is an accepted limitation for this casual-game threat model.
