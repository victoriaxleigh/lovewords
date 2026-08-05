# LoveWords Agent Instructions

## Production database safety

- Treat every migration recorded in production as immutable. Never edit an
  applied migration to ship a fix; add a new forward-only migration instead.
- Never paste or re-run an old migration in the Supabase SQL Editor. Older
  function definitions can silently overwrite newer fixes while migration
  history still reports the fix as applied.
- Never apply `supabase_schema.sql` to an existing environment. It is the
  reference schema for fresh installs only; keep it synchronized with new
  migrations.
- Use the linked CLI workflow for production changes:
  1. `npx supabase migration list --linked`
  2. `npx supabase db push --linked --dry-run`
  3. Review the exact pending migrations.
  4. `npx supabase db push --linked --yes`
  5. Run `npx supabase migration list --linked` again and confirm local and
     remote history match.
- If production contains manually applied or unrecorded SQL, stop and reconcile
  migration history before pushing. Do not use `--include-all`, migration
  repair, or dashboard SQL as a shortcut without explicit owner approval.
- After notification-related database changes, run the full test suite, perform
  one production Nudge, and verify the matching Netlify invocation has no
  Supabase/Postgres errors.
- The `claim_notification_delivery` timestamp variable must remain an
  unambiguous `timestamptz` named `claim_time`. Never restore the old
  `current_time` variable; PostgreSQL resolves it as the `CURRENT_TIME` keyword
  (`timetz`) and breaks every notification claim.

