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
| Serverless functions | Netlify Functions (`netlify/functions/`) | `notify`, `game-analysis*`, `game-coach`, `delete-account` |
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
| `SUPABASE_SERVICE_KEY` | **yes** | Functions (+Runtime) | notify, analysis, coach, delete-account | Service-role key — full DB access. Never in the client bundle. |
| `ANALYSIS_TOKEN_SECRET` | **yes** | Functions (+Runtime) | game-analysis-token / game-analysis | HMAC secret for 1-hour analysis tokens. Generate: `openssl rand -base64 32` (≥32 bytes). |
| `ANTHROPIC_API_KEY` | **yes** | Functions (+Runtime) | game-coach | Claude API key (`sk-ant-...`) from console.anthropic.com. Powers the AI coach. |
| `VAPID_PUBLIC_KEY` | no (public) | Builds, Functions, Runtime | notify | Public half of the Web Push keypair. Listed in `SECRETS_SCAN_OMIT_KEYS`. |
| `VAPID_PRIVATE_KEY` | **yes** | Functions (+Runtime) | notify | Web Push private key. If leaked, rotate the keypair. |
| `VAPID_EMAIL` | no | Functions (+Runtime) | notify | Contact email for push services. |

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

Run in **Supabase → SQL Editor → New query**. These are transactional and safe
to re-run.

| Migration | For | Status |
|---|---|---|
| `alter table games add column if not exists mode text not null default 'partner';` | Partner/Friend mode | apply once |
| `supabase/migrations/20260723000100_private_game_analysis_events.sql` | Analysis export + AI coach (creates `game_analysis_events` + scrub trigger) | apply once |
| RLS delete policy on `games` (see `AGENT_HANDOFF.md` → Supabase Tables) | In-app game deletion | apply once |

The analysis migration must be applied **before** the analysis/coach functions
are used, or exports fall back to `recordingQuality: "basic"` (no per-turn rack
data). See `AGENT_HANDOFF.md` for the full schema.

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
- Finish a game → **Coach me on this game** → a **new** game returns the
  move-by-move review with rack-based tips (`recordingQuality: "full"`). Games
  created before the analysis feature show a "played before full move tracking"
  note and get higher-level feedback only — that's expected, not a bug.

---

## 6. The AI coach — operating notes

- **Model:** `COACH_MODEL` in `netlify/functions/game-coach.js` (currently
  `claude-sonnet-5`, ~4¢/game). `claude-opus-5` is more precise/pricier;
  `claude-haiku-4-5` is cheapest but too vague for concrete better-play advice
  (and rejects the `thinking`/`output_config` params — remove them if you switch).
- **Cost scales with usage, not installs** — it only runs when a player finishes
  a game and taps the button. Rough guide: ~1,000 coached games/month ≈ $40 on
  Sonnet.
- **Don't delete/rotate `ANTHROPIC_API_KEY`** without redeploying, or the coach
  reverts to "not configured."
- **Latency:** Sonnet + adaptive thinking on a long game can approach the
  Netlify sync-function timeout. If that surfaces, lower `effort`, drop the
  `thinking` param, or move the endpoint to streaming.
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
