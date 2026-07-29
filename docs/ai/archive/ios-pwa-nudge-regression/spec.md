---
feature: ios-pwa-nudge-regression
status: complete
created: 2026-07-29
updated: 2026-07-29
iteration: 1
---

## Overview

Nudging from an installed iOS PWA now reports "Could not nudge" after the
authenticated notification changes from player discovery and invites. Restore
reliable delivery without weakening the server-side authorization or cooldown.

## Requirements

- [x] An authenticated player can nudge their opponent from an installed iOS PWA when it is the opponent's turn.
- [x] A stale but refreshable Supabase session is refreshed and the notification request is retried at most once.
- [x] Authorization failures, cooldowns, and network failures must not be reported as successful delivery.
- [x] Notification requests remain bound to the authenticated sender, game participants, active game, and current turn.

## Technical Design

Use the production `notify` function response to identify the failing boundary.
Keep the fix within `src/supabase/gameService.ts` when the failure is caused by
the persisted iOS PWA session: send with the current access token, explicitly
refresh and retry once on HTTP 401, and preserve the existing `sent`,
`cooldown`, and `failed` result contract. Add focused tests in
`__tests__/gameInvites.test.ts`.

If production logs instead identify a server-side failure, make the smallest
correction in `netlify/functions/notify.js` or its SQL support while retaining
all existing authorization checks and add a handler-level regression test.

## Acceptance Criteria

- [x] A notification request that receives 401 refreshes the session and retries once with the new access token.
- [x] A successful retry returns `sent`; a 429 retry returns `cooldown`; a second failure returns `failed`.
- [x] Non-authentication server failures are not retried.
- [x] Existing notification handler authorization and rate-limit tests pass.
- [x] The web production build succeeds.

## Findings

### Implementation Blockers

### QA

### Security

### User Notes

## Pipeline Log

- [iter 1] implement: pending — Diagnose and repair the iOS PWA nudge failure.
- [iter 1] qa: pending — Review after implementation.
- [iter 1] security: pending — Review after implementation.
- [iter 1] implement: complete — Added a one-time session refresh/retry on notify 401; 211 tests and the production web build pass.
- [iter 1] qa: complete — Clean review; 211 tests, production web export, and diff validation pass.
- [iter 1] security: complete — No exploitable issues; server authorization and cooldown enforcement remain intact.

## Outcome

Notification requests now recover once from a rejected access token by
refreshing the persisted Supabase session and retrying with the new token. The
server remains the sole authority for participant checks, turn state, and nudge
cooldowns, and all 211 tests plus the production web build pass.
