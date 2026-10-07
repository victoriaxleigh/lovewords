# LoveWords — Setup Guide 💌

A no-ads word game for two. Web app is live and free; the native
(App Store) build adds a one-free-game-then-$2.99-lifetime paywall.

## 1. Supabase (already configured)

`src/supabase/config.ts` already has the project URL + anon key. Tables:
`profiles`, `games`, `love_notes`, `push_subscriptions` — see
`AGENT_HANDOFF.md` for the full schema and RLS policies.

## 2. Run the app (web)

```bash
cd lovewords
npx expo start --web
```

## 3. Deploy (web)

```bash
npm run build:web
netlify deploy --prod --dir=dist --no-build
```

**➡️ See `DEPLOY.md` for the full deployment runbook** — every environment
variable (and the secret-scope rules), Supabase migrations, auto vs manual
deploy, post-deploy smoke tests, and rollback. The quick notes below are a
summary; `DEPLOY.md` is the source of truth.

### Database migrations

All migrations in `supabase/migrations/` are already applied to production (status
table in `DEPLOY.md` §3). Apply any **new** migration with the linked Supabase CLI
workflow in `AGENTS.md` / `DEPLOY.md` §3, **before** deploying code that depends on it.
Never paste migrations into the SQL Editor, and never apply the full
`supabase_schema.sql` to an existing project; it is for fresh installs only.

### Finished-game analysis export

Already applied in production. On a new environment, deploy the database migration
before the client/functions that write version-2 events:

1. Apply `supabase/migrations/20260723000100_private_game_analysis_events.sql` with
   `npx supabase db push --linked` (dry run first; see `DEPLOY.md` §3). It is
   transactional and safe to rerun.
2. Configure the three Netlify server-only variables below.
3. Run `npm run build:web`, then deploy the site/functions.

This order prevents a newly deployed client from leaving hidden rack/draw/return history in the
participant-readable `games.moves` JSON while the database is still on the old schema. The
migration backfills any pre-migration version-2 events before scrubbing those hidden fields.

### Player discovery and invitations

Already applied in production. On a new environment, apply
`supabase/migrations/20260728000100_player_discovery_invites.sql` the same way before deploying
a client with display-name discovery. It removes broad authenticated profile reads, adds opt-in
discovery, and installs the privacy-safe search and exact email lookup functions the client uses.

The analysis-token functions require these server-only Netlify environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ANALYSIS_TOKEN_SECRET` — a random secret of at least 32 bytes, used to sign
  one-hour game export tokens

Generate the signing secret with `openssl rand -base64 32` and add it in
**Netlify → Site configuration → Environment variables**. Never expose the service key or
analysis signing secret through `EXPO_PUBLIC_*` variables or client code.

---

## Manual steps still needed before the native App Store build works

These require accounts I (the agent) can't create or log into — do these
whenever you're ready to pick up "the Apple stuff":

### Supabase — add as a new forward-only migration when native work starts
Not applied yet. Put this in a new file under `supabase/migrations/` (dated after the
newest applied migration) and apply it with the CLI workflow in `DEPLOY.md` §3,
then mirror it in `supabase_schema.sql`:
```sql
-- Paywall: tracks whether a user has unlocked lifetime access
ALTER TABLE profiles ADD COLUMN has_paid boolean DEFAULT false;
UPDATE profiles SET has_paid = true;  -- grandfather existing accounts

-- Native push: stores each device's Expo push token
ALTER TABLE profiles ADD COLUMN expo_push_token text;
```

### RevenueCat (monetization — $2.99 lifetime unlock)
1. Create a free account at revenuecat.com, add a new project.
2. In App Store Connect, create a non-consumable in-app purchase product,
   e.g. `lovewords_lifetime`, priced at $2.99.
3. In RevenueCat, import that product and attach it to an entitlement named
   `lifetime`.
4. Copy the RevenueCat **public iOS API key** into
   `src/utils/purchases.ts` (`REVENUECAT_API_KEY_IOS`, currently a
   placeholder).

RevenueCat remains the source of truth for access. The app also mirrors successful purchase and
restore results to `profiles.has_paid` for admin/support visibility. That client-writable mirror is
not used to unlock the app and must not be treated as an entitlement or authorization signal.

### Apple Developer Program
1. Enroll ($99/year) at developer.apple.com.
2. `npm install -g eas-cli`, then `eas login` and `eas build:configure` —
   this fills in the real `extra.eas.projectId` in `app.json` (currently a
   placeholder) and links the project to your Expo account.
3. `eas build --platform ios --profile preview` for an internal test build,
   or `--profile production` + `eas submit --platform ios` for App Store
   submission. Build profiles are already defined in `eas.json`.
4. Also required for App Store review: 1024×1024 icon (already have
   `assets/icon.png`), screenshots per device size, a privacy policy URL,
   and the App Store Connect listing copy.

### What's already wired up, code-side
- Account deletion (Settings → Delete Account) — Apple Guideline 5.1.1(v).
- Paywall gate — native only; the web app stays free/unlimited.
- Native push notifications (`expo-notifications`) — falls back to Web
  Push automatically on the browser/PWA build.

None of the above (IAP purchases, native push, EAS build) can be verified
without an Apple Developer account and a real device — that's expected,
not a bug, until you complete the steps above.

## Project Structure

```
src/
  engine/         # Game logic (board, tiles, scoring, dictionary)
  supabase/       # Supabase config + auth/game services
  components/     # Board, Tile, TileRack, ScoreBoard
  screens/        # Auth, Lobby, Game, Settings, Paywall, LoveNotes
  hooks/          # useAuth
  types/          # TypeScript types
  utils/          # Colors, styles, push notifications, IAP, app badge
```

## Features

- Full 15×15 board with the LoveWords premium-square layout
- 7-tile rack with drag-to-place mechanic
- Word validation via dictionary API
- Scoring with letter/word multipliers + bingo bonus (7 tiles = +35 pts)
- Async multiplayer via Supabase (Postgres + Realtime)
- 💌 Love notes between games — sweet messages instead of ads!
- Push notifications when it's your turn (Web Push on browser, Expo push on native)
- Solo practice mode
- In-app account deletion (Settings)
