---
feature: notification-claim-timestamp-fix
status: implementing
created: 2026-07-29
updated: 2026-07-29
iteration: 1
---

## Overview

Every authenticated notification delivery claim fails before its first insert
because the PL/pgSQL identifier `current_time` resolves to PostgreSQL's
`CURRENT_TIME` keyword (`timetz`) in SQL expressions. Replace it with an
unambiguous timestamp variable and ship a focused corrective migration.

## Requirements

- [x] `claim_notification_delivery` uses an unambiguous `timestamptz` variable for every delivery timestamp.
- [x] Existing deduplication, per-pair locking, cooldowns, hourly limits, grants, and authorization behavior remain unchanged.
- [x] Fresh schema installs and already-deployed databases receive the correction.
- [x] A regression test prevents reintroducing the `current_time` keyword collision.

## Technical Design

Rename the local PL/pgSQL variable from `current_time` to `claim_time` in
`supabase/migrations/20260728000100_player_discovery_invites.sql` and
`supabase_schema.sql`. Add a new targeted migration under
`supabase/migrations/` that replaces only
`public.claim_notification_delivery(uuid, uuid, text, text)` with the corrected
function body and preserves its `service_role`-only execution grant. Extend
`__tests__/playerDiscoverySql.test.ts` to assert the corrected timestamp
declaration/usages and reject the keyword-shaped declaration.

## Acceptance Criteria

- [ ] The rollback-only production reproduction no longer returns SQLSTATE `42804`.
- [x] The first valid claim can insert `timestamptz` values into `window_started` and `last_delivered_at`.
- [x] Existing cooldown and deduplication SQL remains present.
- [x] The full test suite and production web build pass.
- [ ] The corrective migration is applied to production and Nudge succeeds from the iOS PWA.

## Findings

### Implementation Blockers

- [ ] [iter 1] Applying and verifying the corrective migration requires Supabase project access.

### QA

### Security

### User Notes

## Pipeline Log

- [iter 1] implement: pending — Correct the timestamp collision and add a targeted production migration.
- [iter 1] qa: pending — Review SQL behavior and migration coverage.
- [iter 1] security: pending — Review grants, locking, authorization, and rate-limit preservation.
- [iter 1] implement: complete — Renamed the colliding variable, added a targeted corrective migration, and passed 212 tests plus the web build.
- [iter 1] qa: complete — Clean review; 212 tests, targeted SQL contracts, exact function-body comparison, and web build pass.
- [iter 1] security: complete — Clean review; service-role authorization, hardened search path, locking, limits, and dedupe remain intact.
