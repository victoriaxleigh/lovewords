# Changelog

## Unreleased

### Fixed

- **Nudges failed with a database timestamp type error.** The notification claim
  function now uses an unambiguous `timestamptz` variable, with a focused
  production migration and regression coverage.
- **Push notifications and nudges failed after the server-authorized notify
  deploy.** New-format opaque Supabase secret keys (`sb_secret_...`) were being
  sent as `Authorization: Bearer` tokens, which PostgREST rejects, so every
  Data API read in the serverless functions failed with a 502 and no
  notification was delivered. Opaque keys now travel only in the `apikey`
  header, while legacy service-role JWTs keep the Bearer form. The same fix
  covers account deletion and game-analysis/coach functions.
- **Nudging from an installed iOS PWA reported "Could not nudge."** A suspended
  PWA can hand back an expired access token; the client now refreshes the
  session once and retries on a 401 before giving up.

### Added

- **Invite someone who isn't on LoveWords yet.** Entering an email that has no
  account no longer dead-ends — it mints a single-use invite code and shareable
  link (copy, share sheet, or texted code), and emails the invite when a
  provider is configured. Opening the link (`?invite=CODE`) or entering the code
  on sign-up redeems it into a real game with the inviter, created through the
  same server-owned `create_active_game` grant path as every other game.
  Requires the `email_invites` migration; email delivery is optional and set up
  with `RESEND_API_KEY` (see DEPLOY.md).
- Opt-in player discovery by display name with privacy-safe player codes and
  accept/decline/cancel game invitations.
- Server-authorized game creation and event-bound, abuse-limited push notifications.
- Local rack organization during either player's turn: tiles follow horizontal drags without
  changing shared game state, while board placement remains turn-gated.
- In-app **AI game coach**: a move-by-move review on the finished-game screen (Claude Sonnet
  via the new `game-coach.js` function), replacing the shareable curl command. Names the
  specific better play you could have made, with estimated scores. Requires `ANTHROPIC_API_KEY`.
- Home-screen game cards now **label each score** (You / opponent, or P1 / P2 for solo) and
  **highlight the winning score**.
- **Swap confirmation step** ("Yes, Swap") mirroring the Pass confirmation.
- `DEPLOY.md` deployment runbook (env vars + scopes, migrations, verification, rollback).
- Short-lived capability tokens and a sanitized JSON endpoint for finished-game analysis.
- A finished-game UI that generates a shareable curl command, with a local mock preview mode.
- Version-2 play, swap, and pass history with deterministic board replay and legacy-game fallback.
- Private, service-role-only storage for analysis rack, draw, and return data, including a
  transactional and rerunnable Supabase migration.

### Changed

- Declined invitations are filtered by PostgREST and removed after 30 days; private discovery,
  notification, lookup-limit, and creation-grant bookkeeping now has scheduled retention.
- Rack dragging now previews insertion slots and smoothly transitions between reordering and board
  placement without jittery direction switching.
- **Swap and Pass** buttons are now visually distinct (blue 🔄 / amber ⏭ with icons) to prevent
  mis-taps; new colors verified at WCAG AAA and guarded by `contrast.test.ts`.
- **Tile bag rebalanced**: E trimmed 13→11 (→ R, T) to reduce vowel-heavy racks. New games only.
  The shuffle (Fisher-Yates) was already unbiased.
- New Game email placeholder "Friend's email" → "Email address".
