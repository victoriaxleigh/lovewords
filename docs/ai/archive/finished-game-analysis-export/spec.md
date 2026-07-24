---
feature: finished-game-analysis-export
status: complete
created: 2026-07-23
updated: 2026-07-23
iteration: 2
---

## Overview

Expose a finished LoveWords game as sanitized JSON through a short-lived capability token so a
player can hand a ready-to-run curl command to an external AI. This is the first pass of the
analysis feature: it proves the authenticated token-generation and unauthenticated export flow
using the game data already recorded, while leaving richer versioned turn recording and board
reconstruction for a follow-up feature.

## Requirements

- [x] An authenticated player can create a one-hour analysis token for a finished game they
  participated in.
- [x] Token creation rejects missing or invalid sessions, malformed game IDs, non-participants,
  missing games, and games that are not finished.
- [x] Analysis tokens are stateless, HMAC-signed with a server-only secret, scoped to one game,
  and rejected when malformed, tampered with, or expired.
- [x] A caller holding a valid analysis token can retrieve versioned JSON for its finished game
  without a Supabase session.
- [x] The export uses stable player aliases and omits emails, Supabase UIDs, love notes, raw tile
  IDs, and the stored board.
- [x] The export includes game metadata, mode, timestamps, final scores/racks, bag count, and the
  currently available move history with compact tile placements.
- [x] The finished-game screen can generate a token and display a selectable, ready-to-share curl
  command, including loading and error states.
- [x] Netlify exposes stable `/api/games/:gameId/analysis-token` and `/api/game-analysis` routes and
  documents the required signing-secret environment variable.

## Technical Design

Add a shared CommonJS helper under `netlify/functions/` for UUID validation, bearer parsing,
base64url encoding, HMAC-SHA256 token signing/verification, JSON responses, Supabase REST access,
and export sanitization. Tokens use an application-specific prefix and contain a version, game ID,
issued-at time, expiry time, and random nonce. Signatures are checked with a timing-safe comparison.

Add two Netlify functions:

- `game-analysis-token.js` accepts `POST`, verifies the caller's Supabase access token using the
  existing `/auth/v1/user` pattern, fetches only the authorization fields needed from the game,
  checks participation and `finished` status, then returns the token, expiry, endpoint, and curl.
- `game-analysis.js` accepts `GET`, validates the capability bearer token, fetches the scoped game
  with the service role key, re-checks `finished` status, and returns a sanitized schema-version-1
  export with `Cache-Control: private, no-store`.

Add redirects before the SPA fallback in `netlify.toml`. Add a client helper in
`src/supabase/gameService.ts` that obtains the active Supabase session and requests a token. Extend
the finished state in `src/screens/GameScreen.tsx` with token generation UI; keep the command
selectable instead of adding a clipboard dependency. Document `ANALYSIS_TOKEN_SECRET` in
`SETUP.md`.

Unit-test signing, verification, expiry/tamper handling, and sanitization. Run the existing Jest
suite and TypeScript typecheck/build checks.

## Acceptance Criteria

- [x] A participant can generate a token from a finished game and use the returned curl command to
  receive `application/json`.
- [x] The same token cannot retrieve another game and stops working after its expiry.
- [x] An active game and a finished game owned by someone else cannot produce an analysis token.
- [x] Exported JSON contains no player email, Supabase UID, love-note content, raw tile ID, or
  serialized board.
- [x] Existing gameplay, tests, and the web build continue to work.

## Findings

### Implementation Blockers

### QA

- [x] [iter 1] Add handler-level tests for both Netlify functions covering missing/invalid sessions, missing or unrelated games, unfinished games, method rejection, the valid token-to-export flow, and invalid/expired capability tokens; current automated tests only exercise the shared helper, so most endpoint requirements can regress undetected.

### Security

### User Notes

## Pipeline Log

- [iter 1] implement: complete — Added one-hour signed capability tokens, sanitized export, stable API routes, finished-game UI, docs, and unit coverage; Jest/build/syntax checks pass, while `tsc` retains four pre-existing errors.
- [iter 1] qa: complete — One new finding: endpoint handlers need automated contract and failure-path coverage; Jest, handler smoke checks, syntax checks, and web export pass.
- [iter 1] security: complete — No exploitable issues found in authorization, token validation/scoping, or export sanitization.
- [iter 2] implement: complete — Added handler-level coverage for authorization, ownership, game state, methods, token failures, and the complete token-to-sanitized-export flow; all 100 tests pass.
- [iter 2] qa: complete — Clean pass; 100 tests, function syntax checks, and the production web export pass, with only the unchanged pre-existing TypeScript baseline errors.
- [iter 2] security: complete — No exploitable issues found; handler coverage confirms authorization, ownership, game-state enforcement, capability rejection, and sanitized output.

## Outcome

Completed on 2026-07-23.

- Added a finished-game JSON export protected by a one-hour, game-scoped HMAC capability token.
- Added the finished-game UI that generates a ready-to-run curl command, plus a local mock preview
  path for reviewing the flow without Supabase access.
- Kept the payload versioned and sanitized: stable aliases replace account identities, and private
  notes, raw tile IDs, and stored board snapshots are excluded.
- Verified token and handler failure paths, the full Jest suite, Netlify function syntax, and the
  production web build.
- Follow-up: richer version-2 history and deterministic board reconstruction were completed in the
  companion `versioned-game-history` feature.
