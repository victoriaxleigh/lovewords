# LoveWords — Deployment Guide

How to deploy LoveWords to production and verify it. The web app is a
**Netlify** site (auto-deploys on push to `main`); the backend is **Supabase**;
serverless features (push, analysis export, AI coach) run as **Netlify
Functions**. Native/App Store builds are separate — see `APP_STORE.md`.

> TL;DR for a normal change: merge to `main` → Netlify auto-builds with
> `npm run build:web` → live in ~1–2 min. New **env vars** or **DB migrations**
> need the one-time steps below *before* the code that depends on them.

---

## 1. Architecture at a glance

| Piece | Where | Notes |
|---|---|---|
| Web app (PWA) | Netlify, published from `dist/` | Built with `npm run build:web` |
| Serverless functions | Netlify Functions (`netlify/functions/`) | `notify`, `game-analysis*`, `game-coach`, `delete-account`, `send-invite` |
| Database + auth + realtime | Supabase (Postgres) | URL + anon key in `src/supabase/config.ts` |
| Auto-deploy | Push to `main` | `netlify.toml` runs `npm run build:web` |

---

## 2. Environment variables (Netlify)

Set these in **Netlify → Site configuration → Environment variables**. They bind
at **deploy time** — after adding or changing one, you must **redeploy** (a new
build) for functions to see it.

| Variable | Secret? | Scope | Used by | Notes |
|---|---|---|---|---|
| `SUPABASE_URL` | no (public) | Builds, Functions, Runtime | all functions | Same value as `src/supabase/config.ts`. Listed in `SECRETS_SCAN_OMIT_KEYS`. |
| `SUPABASE_SERVICE_KEY` | **yes** | Functions (+Runtime) | notify, analysis, coach, delete-account | Service-role key — full DB access. Never in the client bundle. Use the **secret** key (`sb_secret_…`) or the legacy **`service_role`** JWT — **not** the `anon`/`publishable` key. The functions send opaque `sb_secret_…` keys only in the `apikey` header (a Bearer JWT parse of them 401s → a 502); legacy JWTs still go in `Authorization: Bearer`. |
| `ANALYSIS_TOKEN_SECRET` | **yes** | Functions (+Runtime) | game-analysis-token / game-analysis | HMAC secret for 1-hour analysis tokens. Generate: `openssl rand -base64 32` (≥32 bytes). |
| `ANTHROPIC_API_KEY` | **yes** | Functions (+Runtime) | game-coach | Claude API key (`sk-ant-...`) from console.anthropic.com. Powers the AI coach. |
| `COACH_REVIEW_LIMIT` | no | Functions (+Runtime) | game-coach | Max saved coach reviews per user. Unset, invalid or ≤0 = unlimited (the default). Re-reading an already-saved review never counts. Set it once coach packs are sold; the endpoint answers `402 coach_limit_reached` at the cap. |
| `VAPID_PUBLIC_KEY` | no (public) | Builds, Functions, Runtime | notify | Public half of the Web Push keypair. Listed in `SECRETS_SCAN_OMIT_KEYS`. |
| `VAPID_PRIVATE_KEY` | **yes** | Functions (+Runtime) | notify | Web Push private key. If leaked, rotate the keypair. |
| `VAPID_EMAIL` | no | Functions (+Runtime) | notify | Contact email for push services. |
| `RESEND_API_KEY` | **yes** | Functions (+Runtime) | send-invite | [Resend](https://resend.com) API key. **Optional** — when unset, email invites still work; the inviter just copies/shares the link or texts the code (`send-invite` returns `emailed:false`). Set it to also email invites. |
| `INVITE_FROM_EMAIL` | no | Functions (+Runtime) | send-invite | From address for invite emails, e.g. `LoveWords <play@yourdomain>`. Defaults to Resend's shared onboarding sender. Requires a verified domain to send from your own address. |
| `APP_URL` | no | Functions (+Runtime) | send-invite | Public site origin used to build invite links (`<APP_URL>/?invite=CODE`). Defaults to the production Netlify URL. |

### ⚠️ Two rules that bite people

1. **Secrets can't use the "Post-processing" scope**, so Netlify **rejects
   "All scopes"** for a secret variable. For any secret above, tick the
   scopes individually — **Functions** (required), plus Runtime/Builds — and
   leave **Post-processing** unchecked. A server-only key with just **Functions**
   is correct. If a function returns `... is not configured`, this scope is the
   usual cause.
2. **Only `SUPABASE_URL` and `VAPID_PUBLIC_KEY`** belong in
   `SECRETS_SCAN_OMIT_KEYS` (in `netlify.toml`) — they're public and ship in the
   client bundle by design. **Never** add a real secret there; secrets are used
   only inside functions and never reach `dist/`, so the scanner won't flag them.

---

## 3. Supabase migrations (one-time, before dependent code)

Apply new migrations with the **linked CLI workflow in `AGENTS.md`**, never by
pasting SQL into the Supabase SQL Editor:

```sh
npx supabase migration list --linked      # Local and Remote must match for everything already applied
npx supabase db push --linked --dry-run   # review: only the new file(s) should be listed
npx supabase db push --linked --yes
npx supabase migration list --linked      # confirm they now match again
```

One-time setup on a new machine: `npx supabase login`, then
`npx supabase link --project-ref <project ref>` (Project Settings → General →
Project ID). Two rules learned the hard way:

- **A new migration must be dated after the newest applied one.** `db push`
  refuses an earlier-dated file (getting past that needs `--include-all`, which
  needs owner approval). If an unapplied migration sorts too early, rename it.
- **Push from a checkout that contains every applied migration file** (normally
  `main`). Otherwise the CLI says "Remote migration versions not found". Do not
  run the `migration repair` / `db pull` commands it suggests.

**Status as of 2026-10-07: everything below is applied to production**, and the
CLI history matches. The first two rows predate the CLI workflow and were run by
hand once.

| Migration | For | Status |
|---|---|---|
| `alter table games add column if not exists mode text not null default 'partner';` | Partner/Friend mode | ✅ applied (by hand) |
| RLS delete policy on `games` (see `AGENT_HANDOFF.md` → Supabase Tables) | In-app game deletion | ✅ applied (by hand) |
| `supabase/migrations/20260723000100_private_game_analysis_events.sql` | Analysis export + AI coach (creates `game_analysis_events` + scrub trigger) | ✅ applied |
| `supabase/migrations/20260728000100_player_discovery_invites.sql` | Player discovery + invites **and** server-authorized push (creates `search_profiles`, `find_profile_by_email`, `create_active_game`, the invite guard, and the notification tables + `claim_notification_delivery` RPC that `notify` depends on) | ✅ applied |
| `supabase/migrations/20260729000100_notification_claim_timestamp_fix.sql` | **Required for push + nudge.** Corrects a `current_time` PL/pgSQL keyword collision that made every `claim_notification_delivery` call throw, so `notify` returned 502 and no notification (turn / love note / invite / nudge) was delivered | ✅ applied |
| `supabase/migrations/20260731000100_email_invites.sql` | Email / code invites for people not yet on the app (creates `email_invites` + `create_email_invite` / `create_phone_invite` / `redeem_email_invite` RPCs). Redemption creates the game **atomically** inside the RPC via `create_active_game`; codes use a CSPRNG; `claim_invite_email_delivery` rate-limits invite emails; `find_profile_by_email` raises on throttle. Required for invites; the optional `send-invite` function only *delivers* email invites | ✅ applied |
| `supabase/migrations/20260804000100_restore_notification_claim_timestamp_fix.sql` | Restores the corrected `claim_notification_delivery` (`claim_time`) after an older migration re-applied in the SQL Editor overwrote it | ✅ applied |
| `supabase/migrations/20261007000100_game_solutions.sql` | Post-game solve cache (#38): backend-only `game_solutions`, one row per finished game, read and upserted by `game-solve` / `game-coach`. Without it the functions still work, with a live solve on every request | ✅ applied 2026-10-07 |
| `supabase/migrations/20261007000200_game_coach_notes.sql` | Saved coach reviews + optional quota (#41): backend-only `game_coach_notes`. Without it the coach still works; reviews just aren't saved or limited | ✅ applied 2026-10-07 |

The analysis migration must be applied **before** the analysis/coach functions
are used, or exports fall back to `recordingQuality: "basic"` (no per-turn rack
data). See `AGENT_HANDOFF.md` for the full schema.

⚠️ **The two notification migrations are what make push work at all.** The
`notify` function reads games and claims each delivery through the service role;
if `20260728000100` (RPC/tables) or `20260729000100` (timestamp fix) is not
applied, notifications fail server-side with a **502** that surfaces in the app
as **"Could not nudge (E502)"**. The whole schema also lives in
`supabase_schema.sql`, but that file is for **fresh installs only**: never apply
it to an existing environment (see `AGENTS.md`).

---

## 4. Deploy

### Auto-deploy (normal path)
Push/merge to `main`. Netlify runs `npm run build:web` and publishes `dist/`.
Watch **Netlify → Deploys** for **Building → Published** (~1–2 min).

### Manual deploy (from your machine)
```sh
cd lovewords
npm run build:web                             # icons → expo export → inject PWA/iOS meta
netlify deploy --prod --dir=dist --no-build   # deploy the prebuilt dist/
```
- **Use `npm run build:web`, not a bare `expo export`** — the bare export omits
  the PWA/iOS `<head>` tags.
- `--no-build` is required for manual CLI deploys (without it the CLI tries to
  install extensions and 403s).
- Needs `netlify login` first. On a 429 (rate limit), wait 10–15 min.

### Forcing a redeploy (e.g. after adding an env var)
Netlify UI → **Deploys → Trigger deploy → Clear cache and deploy site**, or push
any commit to `main` (an empty commit works: `git commit --allow-empty`).

---

## 5. Post-deploy verification

Once **Published**, smoke-test the functions (no login needed — these check
wiring, not a real game). Replace the host if your site differs.

```sh
# Analysis token endpoint — expect 401 "Missing Authorization header"
curl -i -X POST "https://lovewords1234.netlify.app/api/games/11111111-1111-4111-8111-111111111111/analysis-token"

# AI coach endpoint — expect 401 "Missing Authorization header"
curl -i -X POST "https://lovewords1234.netlify.app/api/games/11111111-1111-4111-8111-111111111111/coach"
```

Reading the result:
- **401** → function is live **and** its env vars are wired ✅
- **500 "... is not configured"** → a required env var is missing or not
  Functions-scoped (see §2 rule 1); fix and redeploy.
- **400 "Invalid game ID"** → you used a non-v4 UUID; use the one above.

Then the real end-to-end checks:
- Sign in, start a **new** game, make a move — confirm play/realtime works.
- **Push / nudge:** on a two-player game where it's the opponent's turn, tap
  **👉 Nudge them**. Success shows **✅ Nudged!**; the server-owned cooldown
  shows **⏳ Already nudged**. A **"Could not nudge (E502)"** means a server-side
  Supabase call failed — check that both notification migrations are applied and
  that `SUPABASE_SERVICE_KEY` is the secret/service_role key (see §2–§3). The
  client also distinguishes `E401`/`ESESSION` (auth) and `ENETWORK` from the
  `E502` Data-API failure, so the button code tells you which boundary broke.
- Open a finished game twice: the per-turn best-plays table should come back
  almost instantly the second time (served from `game_solutions`).
- Tap **Coach me** twice on the same game: the second tap returns the saved
  review immediately (served from `game_coach_notes`).
- Finish a game → **Coach me on this game** → a **new** game returns the
  move-by-move review with rack-based tips (`recordingQuality: "full"`). Games
  created before the analysis feature show a "played before full move tracking"
  note and get higher-level feedback only — that's expected, not a bug.

---

## 6. The AI coach — operating notes

- **Model:** `COACH_MODEL` in `netlify/functions/game-coach.js` (currently
  `claude-sonnet-5-5`, ~4¢ per new review). `claude-opus-5-5` is more
  precise/pricier; `claude-haiku-4-5` is cheapest but too vague for concrete
  better-play advice (and rejects the `thinking`/`output_config` params — remove
  them if you switch).
- **Each review is generated once per player per game** and saved in
  `game_coach_notes`; pressing "Coach me" again is free. The solver result is
  shared through `game_solutions`, so the coach rarely re-solves.
- **`COACH_REVIEW_LIMIT`** (optional Netlify env var) caps how many games each
  player can have reviewed. Unset means unlimited.
- **Cost scales with usage, not installs** — it only runs when a player finishes
  a game and taps the button. Rough guide: ~1,000 coached games/month ≈ $40 on
  Sonnet.
- **Don't delete/rotate `ANTHROPIC_API_KEY`** without redeploying, or the coach
  reverts to "not configured."
- **Latency:** the coach shares one 50 s budget (Netlify's synchronous limit is
  60 s): up to 15 s for a live solve, 30 s reserved for the model. With the solve
  cache, a normal press skips the solve entirely. If reviews still time out,
  lower `effort`, drop the `thinking` param, or move the endpoint to streaming.
- **`max_tokens` is 4000.** Very long games have been seen to cut off before the
  takeaways; raise it in `game-coach.js` if that recurs.
- **App Store TODO:** gate the coach behind premium via the dormant
  `MONETIZATION_ENABLED` flag in `src/utils/purchases.ts` before launch.

---

## 7. Rollback

- **Netlify → Deploys** → open a previous successful deploy → **Publish deploy**
  (instant, no rebuild).
- Or revert the commit on `main` and let auto-deploy rebuild.
- Env-var and DB-migration changes are **not** reverted by a Netlify rollback —
  undo those separately (Supabase migrations here are additive/idempotent, so a
  code rollback is safe to leave them in place).
