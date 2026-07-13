# LoveWords — Setup Guide 💌

A no-ads Words with Friends clone. Web app is live and free; the native
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

See `AGENT_HANDOFF.md` → Deployment for the full pitfalls list (rate limits,
required Netlify env vars, etc).

---

## Manual steps still needed before the native App Store build works

These require accounts I (the agent) can't create or log into — do these
whenever you're ready to pick up "the Apple stuff":

### Supabase — run once in the SQL Editor
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

- Full 15×15 board with WWF bonus squares
- 7-tile rack with drag-to-place mechanic
- Word validation via dictionary API
- Scoring with letter/word multipliers + bingo bonus (7 tiles = +35 pts)
- Async multiplayer via Supabase (Postgres + Realtime)
- 💌 Love notes between games — sweet messages instead of ads!
- Push notifications when it's your turn (Web Push on browser, Expo push on native)
- Solo practice mode
- In-app account deletion (Settings)
