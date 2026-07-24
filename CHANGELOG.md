# Changelog

## Unreleased

### Added

- Short-lived capability tokens and a sanitized JSON endpoint for finished-game analysis.
- A finished-game UI that generates a shareable curl command, with a local mock preview mode.
- Version-2 play, swap, and pass history with deterministic board replay and legacy-game fallback.
- Private, service-role-only storage for analysis rack, draw, and return data, including a
  transactional and rerunnable Supabase migration.
