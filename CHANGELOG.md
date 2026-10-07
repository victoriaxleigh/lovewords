# Changelog

Everything listed here is merged to `main` and live in production. Each date is
when that group of changes reached `main`.

## 2026-10-02 – 2026-10-07

### Added

- **Stats pages.** A new 📊 button in the Lobby header opens a Stats screen:
  your win–loss–tie record and win rate, partner and friend splits, average
  score, best game, best and longest word, bingos, points per play and streaks,
  plus a head-to-head list of everyone you've played. Tapping a player (or the
  new "Head-to-head" link on a finished game) opens a page for the two of you:
  wins side by side, a comparison table, biggest win and loss, and every game
  you've played together. Like achievements, everything is computed on the fly
  from finished two-player games in one pure module (`src/engine/stats.ts`);
  solo games don't count. (#39)
- **Achievements board.** A new 🏅 button in the Lobby header opens an
  Achievements screen with nine badges (First Date, Going Steady, Committed,
  Sweet Victory, Nail-biter, Bingo!, Double Bingo, Wordsmith, Long Story),
  computed on the fly from your finished two-player games. Solo games don't
  count. Nothing is stored yet; the rules live in one pure module
  (`src/engine/achievements.ts`) so a later server-side version can reuse them. (#35)
- **Friend-track achievements.** The game-count badges now come in two tracks:
  First Date, Going Steady and Committed count partner games only, and the new
  Game On, Regular Rivals and Ride or Die count friend games only, each with
  its own pixel-art badge. The board now has twelve badges. (#33, #36)
- **Forgot password.** The sign-in screen now has a "Forgot password?" link
  that emails a reset link. Opening it lands on a "Choose a new password"
  screen instead of silently signing you in without a password; after saving,
  you're signed out and asked to sign in with the new password. An abandoned
  reset re-opens that screen on the next launch rather than leaving you signed
  in, and an expired link says so on the sign-in screen. Works under `?dev=1`
  too (the reset link is logged to the console). (#32)
- **Unread dot for love notes.** Notes sent to you light a dot on that game's
  lobby row and on the game screen's Note/Chat button; opening the notes clears
  it. Uses the existing `love_notes.read` column; no migration. (#31)

### Changed

- **Original board layout.** The premium squares now use LoveWords' own
  balanced layout (8 triple-word, 16 double-word, 12 triple-letter, 24
  double-letter, symmetric on all eight axes, no word premium on the centre
  row/column, triple-word squares at least 8 apart in a lane). New games use it;
  games already in progress keep the layout stored on their board. The server
  solver and analysis export read each game's own layout (export
  `boardMetadata.version` 2 for the new layout, 1 for older games).
  Known gap: the client history replay still draws the new layout under old
  games' tiles (cosmetic only). The board squares are now drawn as rounded,
  separated tiles in the existing colours. (#41)
- **Coach.** Renamed away from third-party game names, model string set to
  `claude-sonnet-5-5`, and each finished game's review is saved per user in
  `game_coach_notes`, so "Coach me again" re-reads it for free. Optional
  `COACH_REVIEW_LIMIT` caps saved reviews per user (hook for sold packs). (#41)
- **Post-game analysis is solved once per game.** The turn-by-turn solve for a
  finished game is now cached in a new backend-only `game_solutions` table, so
  opening the same game again, the other player opening it, and "Coach me" all
  reuse one stored result instead of re-running the solver (up to ~25 s in
  production). Solves cut short by the time budget are never cached, a
  `SOLVER_VERSION` bump invalidates old rows, and any cache failure falls back
  to a live solve. Migration `20261007000100_game_solutions.sql`. (#38, closes #25)
- **Names show as first name + last initial** ("Tom D.") in the lobby,
  scoreboard, game banners, finished screen, New Game results, Stats and
  Head-to-head. If two opponents would shorten to the same name, both show in
  full. Accessibility labels keep full names. (#40)

### Fixed

- **Long names no longer slide under the lobby header buttons**, and game-card
  names can wrap to two lines. (#40)
- **The chat box no longer zooms the page on iOS** when you tap into it, and
  pinch-zoom still works. (#40)
- **Developer:** `npx tsc --noEmit` is clean; the four long-standing type errors
  are fixed with no behaviour change. (#37)

## 2026-09-08

### Added

- **Post-game move solver.** For every turn of a finished game, the server works
  out the best plays available from the rack the player actually held, using the
  real board and scoring rules, and the finished-game screen shows them as a
  per-turn table. The AI coach is now grounded in those facts instead of guessing
  words. (#24; refined in #28)

## July – August 2026

### Added

- **Streamlined "New game" flow.** Starting a game now leads with a single
  "invite by email or phone" field that always works — it starts the game if
  they're already a member, or sends an invite if not. Finding a player by
  display name is now a clearly-secondary option that explains the
  "Discoverable" opt-in instead of silently returning nothing, and points you to
  the email/phone invite when no one matches.
- **Invite someone who isn't on LoveWords yet, by email or phone.** Entering an
  email that has no account no longer dead-ends — it mints a single-use invite
  code and shareable link (copy, share sheet, or texted code), and emails the
  invite when a provider is configured. You can also invite by **phone number**:
  the app builds the same invite and opens your Messages app prefilled so you
  text it yourself (no SMS provider needed). Opening the link (`?invite=CODE`) or
  entering the code on sign-up redeems it into a real game with the inviter,
  created through the same server-owned `create_active_game` grant path as every
  other game — redemption is **atomic** (the invite is only spent once the game
  exists) and idempotent for the redeemer. Invite codes use a CSPRNG, redemption
  guesses are throttled durably, and invite emails are rate-limited (60s cooldown,
  5 per invite). Requires the `email_invites` migration; auto-sending email
  invites is optional and set up with `RESEND_API_KEY` (see DEPLOY.md).
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
