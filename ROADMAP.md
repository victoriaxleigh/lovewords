# LoveWords — Product Roadmap

> Horizon: H2 2026 → 2027. Last updated 2026-07-31.
> A balanced plan: launch iOS, lay monetization groundwork, and keep hardening
> in parallel. Companion docs: `AGENT_HANDOFF.md` (architecture), `ISSUES.md`
> (bug/UX backlog), `APP_STORE.md` (submission kit), `DEPLOY.md` (runbook).

---

## Where we are today (shipped)

LoveWords is a Words-with-Friends-style word game built for two, live as an
installable web PWA on Netlify.

- **Core game** — 15×15 board with letter/word bonuses, WWF-style scoring, swap
  & pass (with confirm steps), blank tiles, ENABLE dictionary (~178k words).
- **Async multiplayer** — Supabase Postgres + Realtime; turn-based, no pressure.
- **Two relationship modes** — Partner 💕 (love notes) and Friend 🎲 (banter),
  chosen per game; same engine, mode-aware copy.
- **Solo practice mode** — full game against yourself to sharpen play.
- **In-game chat / love notes** — mode-aware, with quick-notes and smack talk.
- **Push notifications & nudges** — Web Push (PWA) + Expo push (native-ready),
  event-bound and abuse-limited; recently hardened (Session 11).
- **Opt-in player discovery** — find people by display name via privacy-safe
  player codes; accept/decline/cancel invitations.
- **AI game coach** — move-by-move review on finished games (Claude Sonnet),
  currently free/ungated.
- **Server-authorized game creation** and short-lived analysis capability tokens.
- **App Store kit prepared** — listing copy, privacy policy, App Privacy answers,
  and pre-submit checklist all drafted (`APP_STORE.md`).

**Biggest gap:** LoveWords is web-only and pre-revenue. The iOS build is blocked
on Apple Developer Program enrollment, and monetization is wired but dormant.

---

## Guiding principles

1. **Cozy, not competitive.** The product is about staying connected with the
   people you love — polish and warmth beat feature count.
2. **Ship the smallest safe thing.** v1.0 launches free to keep the first App
   Store review simple; revenue is a fast-follow.
3. **Trust before scale.** Stranger-facing features (matchmaking) don't ship
   until block/report/filter safety exists.
4. **Keep the docs current.** Every shipped item updates `CHANGELOG.md`,
   `RELEASE_NOTES.md`, and the relevant runbook.

---

## NOW — Q3 2026 (Aug–Sep): Launch iOS

**Theme: get on the App Store, free and clean.**

| # | Item | Notes / source |
|---|------|----------------|
| 1 | **Apple Developer enrollment** | Blocker for everything below. $99/yr. (`AGENT_HANDOFF.md` §6) |
| 2 | **EAS build + submit (v1.0, free)** | `eas init` → build → App Store Connect record → `eas submit`. Bundle `com.lovewords.app`. |
| 3 | **App Store screenshots** | Capture at 1290×2796 from the iOS Simulator; framing/captions in `APP_STORE.md`. |
| 4 | **Privacy policy email** | Replace `ADD-YOUR-CONTACT-EMAIL-HERE` in `public/privacy.html`, redeploy. |
| 5 | **End-to-end push verification** | Confirm the opponent receives a notification while off-page (Nice-to-fix #5). |
| 6 | **Repo hygiene** | Delete abandoned `src/firebase/` (4 pre-existing TS errors); remove unused `exchangeTiles`. |

**Exit criteria:** v1.0 approved and downloadable on iOS; push confirmed working
end-to-end for a real opponent.

---

## NEXT — Q4 2026 (Oct–Dec): Monetize + broaden reach

**Theme: turn on revenue, add Android, start hardening the backend.**

### Monetization (v1.1)
- **Flip `MONETIZATION_ENABLED`** → `true`; paste the real RevenueCat key; create
  the `$2.99` `lovewords_lifetime` non-consumable in App Store Connect + RevenueCat.
  Model: **3 free games → $2.99 lifetime unlock** (`FREE_GAME_LIMIT = 3`).
- **Gate the AI coach behind premium** — wire the "🤖 Coach me" button to the
  monetization flag (~4¢/game, finished-game only). (`ISSUES.md` TODO, `DEPLOY.md` §6)

### Platform
- **Android launch** — the gesture system was already rewritten to
  `react-native-gesture-handler` (Session 8) to unblock native. EAS Android build
  + Play Store listing (reuse `APP_STORE.md` copy).

### Backend hardening (foundational, do before matchmaking)
- **Server-authoritative game state** (Issue 33) — move play/swap/pass/finish into
  validated Supabase RPCs; revoke direct client writes to authoritative columns;
  derive completion server-side. Prerequisite for fair play at scale.

### Polish
- **Board bonus-square contrast** — the TW/DW/TL/DL labels fail WCAG AAA (DW fails
  AA). Recolor for accessibility. (`AGENT_HANDOFF.md`, `ISSUES.md`)
- **Remaining UI consistency** — finish the shared style-token cleanup (Issue 5).

**Exit criteria:** paying customers on iOS; Android in review; gameplay writes
validated server-side.

---

## LATER — 2027: Grow the player base

**Theme: meet new people safely, and give players reasons to come back.**

### Growth: random matchmaking (Phase 2)
Deferred until its safety prerequisites exist. Gated on:
- **RLS rewrite** — current policies assume both UIDs are known at insert; random
  pairing breaks that assumption. (`AGENT_HANDOFF.md` Phase 2 note)
- **Stranger safety — mandatory before this ships:** block, report, and a content
  filter on free-text chat. Apple flags UGC under Guideline 1.2 once strangers are
  paired. (`APP_STORE.md`, `AGENT_HANDOFF.md`)

### Retention & social
- **Rematch & streaks** — one-tap rematch (service already carries mode through)
  and daily/weekly play streaks.
- **Leaderboards & stats** — per-player win/loss, best word, average score.
- **Richer profiles** — avatars beyond initials, display-name discovery upgrades.
- **Notifications tuning** — smart nudges, quiet hours, digest of waiting games.

### Depth (candidate, demand-driven)
- Themed tile sets / board skins (cosmetic, complements the cozy brand).
- Multiple dictionaries / languages.
- Tournaments or async leagues for friend groups.

**Exit criteria:** measurable week-4 retention lift and a safe path to playing
with people outside your contacts.

---

## Cross-cutting themes (every quarter)

- **Reliability** — the game has had a long tail of white-screen/realtime bugs
  (`ISSUES.md`); keep the regression tests green (currently 217 passing) and add
  coverage with each fix.
- **Accessibility** — maintain WCAG AAA text contrast; extend the emoji/screen-
  reader labeling pattern to new surfaces.
- **Trust & safety** — scale safety controls ahead of, not behind, exposure to
  strangers.
- **Cost discipline** — AI coach spend stays event-bound; monitor per-game cost.

---

## Success metrics

| Horizon | Primary metric |
|---------|----------------|
| Now | iOS v1.0 approved; push delivery confirmed |
| Next | First paid unlocks; conversion of games-played → purchase; Android live |
| Later | Week-4 retention; matches started via matchmaking; safety-report resolution time |

---

## Parked / out of scope (for now)

- **Real-time (non-async) play** — the product is deliberately turn-based and
  low-pressure.
- **Ads** — "no clutter, no ads" is a listing promise; monetization is the
  one-time unlock instead.
- **Address-book contact import** — App Privacy label stays clean (Contact Info
  only, never the device address book).
- **Archived-games feature** — dropped by request in Session 9.
