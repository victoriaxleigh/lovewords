# Changelog

## Unreleased

### Added

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

- **Swap and Pass** buttons are now visually distinct (blue 🔄 / amber ⏭ with icons) to prevent
  mis-taps; new colors verified at WCAG AAA and guarded by `contrast.test.ts`.
- **Tile bag rebalanced**: E trimmed 13→11 (→ R, T) to reduce vowel-heavy racks. New games only.
  The shuffle (Fisher-Yates) was already unbiased.
- New Game email placeholder "Friend's email" → "Email address".
