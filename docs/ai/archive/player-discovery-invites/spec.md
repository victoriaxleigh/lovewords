---
feature: player-discovery-invites
status: complete
created: 2026-07-27
updated: 2026-07-28
iteration: 3
---

## Overview

Let signed-in players find discoverable people by display name and invite them to a game without
knowing their email address. Discovery is explicitly opt-in, returns only safe public profile
fields, and requires the recipient to accept before gameplay begins.

## Requirements

- [x] Profiles have a `discoverable` setting that defaults to false and can only be changed by
  the profile owner.
- [x] Settings explains discovery clearly and lets the signed-in player load and change their
  discoverability without exposing their email.
- [x] Authenticated players can search discoverable profiles by a trimmed display-name prefix of
  at least three characters; results exclude the caller, return at most 20 entries, and contain
  only profile ID, display name, and a short non-secret player code for duplicate-name
  disambiguation.
- [x] Broad authenticated reads of `profiles` are removed. Exact email lookup continues through a
  server-side function for the existing email flow, while arbitrary clients cannot list profile
  emails.
- [x] Selecting a search result creates a `waiting` game invitation with no dealt tiles and sends
  a best-effort invite notification; it does not start gameplay immediately.
- [x] Incoming invitations can be accepted or declined, outgoing invitations can be cancelled,
  and declined/cancelled rows are hidden from active and past game lists.
- [x] Accepting an invitation is limited to the invited player, initializes a normal version-2
  game, and changes its status to `active`; the inviter takes the first turn.
- [x] The existing exact-email and solo-game flows continue to work without requiring discovery.
- [x] The in-memory `?dev=1` client supports discovery, settings, and outgoing invitation review
  with seeded discoverable profiles.
- [x] A standalone idempotent migration and `supabase_schema.sql` both define the profile privacy,
  discovery functions, supporting index, and execute privileges required by the feature.

## Technical Design

Add `discoverable boolean not null default false` to `profiles`. Replace the broad
authenticated `profiles_read` policy with owner-only reads and retain owner-only writes with an
explicit `with check`. Add two `security definer` SQL functions with a fixed search path:

- `search_profiles(search_query text)` validates authentication and a three-character trimmed
  prefix, excludes the caller, filters to discoverable profiles, limits results, and returns
  `(profile_id, display_name, player_code)` without email.
- `find_profile_by_email(lookup_email text)` preserves exact normalized email invitations while
  returning one matching profile only to an authenticated caller.

Revoke both functions from `public`/`anon` and grant execution to `authenticated`. Add a standalone
timestamped migration under `supabase/migrations/` and mirror it in `supabase_schema.sql`. Document
the deployment requirement in `SETUP.md`.

Reuse `games.status = 'waiting'` for invitations and add `declined` to the client status union.
`createGameInvite` in `src/supabase/gameService.ts` writes player identities, an empty board, empty
racks/bag, and no moves. `acceptGameInvite` validates that the current user is player two and that
the game is still waiting, then creates/deals a normal tile bag, preserves history-version
provenance, activates the game, and leaves the inviter as `current_turn`. Decline and cancel
validate recipient/sender identity respectively before marking the row declined. Existing
client-authoritative game RLS remains a documented project limitation; client guards and scoped
updates prevent accidental invalid transitions.

Active-game creation uses a security-definer `create_active_game` RPC instead of treating an
email-bearing `Player` object as an authorization contract. The RPC accepts gameplay state plus an
explicit creation reason (solo, exact-email match, or rematch), resolves trusted player identities
server-side, and records `rematch_of` when applicable. Direct active-row inserts are rejected.
Emails remain lookup inputs only and are not stored in multiplayer game participants.

Push requests identify the immutable event that caused them: the invitation game, appended move,
or inserted love note. The notification function verifies that event before claiming delivery.
Delivery deduplication is event-based and abuse limits are keyed globally by sender, recipient, and
notification type rather than by game. Nudge is the only eventless notification and returns its
server cooldown result to the UI.

Add safe profile/discovery helpers in `src/supabase/authService.ts`. Extend
`src/screens/NewGameModal.tsx` with display-name search as the default path plus the existing email
fallback. Extend `src/screens/LobbyScreen.tsx` with incoming/outgoing invitation cards and
accept/decline/cancel handlers. Add a discoverability control to `src/screens/SettingsScreen.tsx`.
Extend the notification function with an `invite` type.

Update `src/supabase/mockClient.ts` with RPC support and seeded discoverable profiles so the search
and outgoing-waiting states can be reviewed locally. Add focused service, SQL contract, state
transition, and privacy tests. Run the full Jest suite, Netlify function syntax checks, and the
production web build.

## Acceptance Criteria

- [x] A discoverable player appears when another signed-in player enters the first three or more
  characters of their display name, without returning an email address.
- [x] A non-discoverable player and the searching player never appear in discovery results.
- [x] Two people with the same display name can be distinguished by their short player codes.
- [x] Sending an invite produces a waiting invitation for both players but no playable rack.
- [x] Only the recipient UI can accept or decline; accepting deals two seven-tile racks and opens
  an active game, while decline or sender cancellation removes the invitation from visible lists.
- [x] Existing email-created games and solo practice still start normally.
- [x] Direct authenticated profile reads cannot enumerate other users' emails after the migration.
- [x] Dev mock review, the full test suite, notification syntax checks, and production web build
  pass without new type errors.

## Findings

### Implementation Blockers

### QA

- [x] [iter 1] Waiting and declined invitations consume the native free-game quota because
  `getUserGameCount` counts every game row regardless of status. An unsolicited incoming invite—or
  a sent invite that is later cancelled—can permanently use one of a player's three free games
  without gameplay. Exclude non-playable invitation states from the quota and add regression
  coverage for waiting, declined, active, and finished rows.
- [x] [iter 1] Pending invitation cards are rendered in an unbounded non-scrollable `View` above
  the lobby tabs and `FlatList`. A player with several incoming/outgoing invites can push later
  invite actions and the entire game list off-screen with no way to reach them. Put invitations in
  a scrollable list/header or otherwise bound and paginate/collapse the section, and cover the
  multi-invite layout.
- [x] [iter 1] Display-name search catches every RPC/network failure and converts it to an empty
  result, so deployment or connectivity failures are shown as “No discoverable players found.”
  Preserve and display a retryable search error separately from a genuine zero-result response,
  with coverage for rejected searches.
- [x] [iter 2] Accepting an incoming invitation bypasses the native free-game paywall:
  `handleInvitation` activates and opens the game without calling `isBlockedByPaywall`, while
  solo, email, and outgoing-discovery starts all enforce the limit. Apply the same gate before
  acceptance, leave the invitation pending when blocked, and add coverage for accepting below and
  at the quota.
- [x] [iter 2] The migration revokes profile updates and grants authenticated users only
  `discoverable` and `expo_push_token`, which breaks the documented RevenueCat
  `mirrorHasPaidToSupabase` update to `has_paid`; purchase/restore still reports success while the
  admin-support mirror silently remains false. Preserve this existing integration through a safe
  server-owned update path or compatible column privilege, and add a regression contract for the
  payment mirror.
- [x] [iter 3] Rematching a completed discovery-created game fails under the new active-insert
  validation. Discovery invitations blank both stored player emails, acceptance preserves those
  blanks, and `createRematch` passes the same players to `createGame`; the trigger then rejects the
  insert because multiplayer emails do not match `auth.users`. Add a privacy-safe
  server-authoritative rematch path or otherwise rehydrate validated identities without exposing
  email, and cover the full discovery invite → accept → finish → rematch flow alongside solo and
  exact-email rematches.
- [x] [iter 3] The durable notification limiter enforces a one-hour nudge cooldown, but
  `GameScreen` re-enables the Nudge button after 30 seconds and immediately displays “Nudged!”
  while `sendNudge` discards the endpoint's 429 response. For the remaining cooldown, the UI
  repeatedly reports success although no push is sent. Align the client cooldown with the server
  or return and surface cooldown responses, with coverage for the allowed first nudge and a
  throttled retry.

### Security

- [x] [iter 1] Invitation role and state transitions are enforced only in client code; the
  `games_update` RLS policy permits either participant to update every game column, so an inviter
  can directly activate or decline their own waiting invitation and either participant can rewrite
  identities or state through PostgREST, bypassing the accept/decline/cancel authorization
  requirements — severity (medium)
- [x] [iter 1] The `games_insert` policy checks only that the caller is `player1_uid`; an
  authenticated client can bypass the UI/paywall and create unlimited malformed or duplicate
  waiting invitations for any discovered profile UUID, flooding a recipient's lobby and database
  rows without a server-enforced invitation shape, uniqueness rule, or rate limit — severity
  (medium)
- [x] [iter 1] `/.netlify/functions/notify` is unauthenticated and trusts caller-supplied
  `recipientUid`, `senderName`, and `type`; because discovery now returns profile UUIDs, any caller
  can send unlimited spoofed invite/turn/message pushes to discovered users using the function's
  service-role token lookup — severity (high)
- [x] [iter 1] `find_profile_by_email` trusts the client-writable `profiles.email` column, while
  the owner update policy permits changing that column and it is not unique or bound to
  `auth.users.email`; an attacker can claim another address and the function's unordered `limit 1`
  can route an email-created game to the attacker instead of the intended player — severity
  (medium)
- [x] [iter 1] `find_profile_by_email` provides an unlimited authenticated existence oracle that
  returns profile ID and display name for exact email guesses regardless of discoverability,
  allowing disposable authenticated accounts to enumerate registered users from leaked or
  generated email lists — severity (medium)
- [x] [iter 2] The invitation trigger returns immediately for every insert whose status is not
  `waiting`, while `games_insert` still permits any authenticated caller to insert a row with
  themselves as `player1_uid`; a caller can use a discovered profile UUID to insert an unsolicited
  `active` game directly, bypassing recipient acceptance, invitation shape checks, duplicate
  prevention, and invitation rate limits — severity (medium)
- [x] [iter 2] The waiting-invitation rate limit can be bypassed by omitting
  `players[0].email`: the shape check uses `<> ''`, which evaluates to null for a missing JSON
  field and does not enter the PL/pgSQL `if`, while the rate-count predicate and partial index
  require `= ''`; an attacker can therefore create, notify, cancel, and recreate unlimited waiting
  invitations that never count toward the hourly allowance. Concurrent invites to different
  recipients can also race because only each player pair, not the sender's rate bucket, is
  advisory-locked — severity (medium)
- [x] [iter 2] The notification endpoint authenticates and verifies the game relationship but has
  no server-side cooldown, delivery ledger, or per-game/type rate limit; an authorized participant
  can replay the same valid invite, turn, nudge, or love-note request indefinitely and flood the
  recipient with push notifications despite the client-only nudge cooldown — severity (medium)
- [x] [iter 3] Notification cooldowns are keyed by game and type rather than sender/recipient
  globally, and the endpoint does not require a corresponding move or love-note event; an
  authenticated player who knows a recipient's email can create unlimited valid active game rows,
  obtaining fresh quotas for each game and sending up to 20 forged `turn` plus 30 forged
  `lovenote` pushes per game per hour without performing those actions, so game churn restores
  effectively unlimited notification spam — severity (medium)

### User Notes

- [x] [2026-07-28] Replaced the email-bearing active-game contract with a server-owned command.
  Exact-email lookup now issues a private five-minute, one-use creation grant; rematches authorize
  from the finished source game; multiplayer game participants store no email.
- [x] [2026-07-28] Bound invite, turn, and love-note pushes to verified events and moved delivery
  limits to the sender/recipient relationship across all games. Nudge now surfaces the server
  cooldown instead of reporting false success.

## Pipeline Log

- [iter 1] implement: complete — Added opt-in discovery, privacy-safe profile lookup, waiting invitations/actions, UI, mock support, migration, notifications, and focused coverage; 170 tests and the web build pass.
- [iter 1] qa: complete — Three findings: invitation quota accounting, unbounded invite layout, and swallowed search failures; 170 tests and the web build pass.
- [iter 1] security: complete — Five findings covering server-side invitation authorization/rate limits, unauthenticated notification spoofing, auth-bound email identity, and lookup throttling.
- [iter 2] implement: complete — Resolved all eight iteration-one findings with server-enforced invitation rules, authenticated notifications, abuse controls, and UI/quota/error-state fixes; 181 tests and the web build pass.
- [iter 2] qa: complete — All iteration-one QA findings pass; found invitation-accept paywall and RevenueCat profile-mirror regressions.
- [iter 2] security: complete — Identity/relationship controls pass; found active-insert, null/race rate-limit, and notification replay bypasses.
- [iter 3] implement: complete — Closed all five iteration-two findings with paywall-gated acceptance, compatible purchase mirroring, validated active inserts, race-safe invite limits, and durable push cooldowns; 193 tests and the web build pass.
- [iter 3] qa: complete — Iteration-two findings pass; found discovery-rematch validation and nudge-cooldown feedback regressions.
- [iter 3] security: complete — Core controls pass; found notification quota multiplication through valid active-game churn.

## Outcome

Players can opt into display-name discovery, find duplicate names safely by player code, and
exchange accept/decline/cancel invitations without sharing email addresses. Active-game creation
now uses explicit server-owned authorization, while notification delivery is authenticated,
event-bound, deduplicated, and rate-limited across games.
