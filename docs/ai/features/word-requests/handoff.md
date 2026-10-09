---
feature: word-requests
status: shipped
created: 2026-10-09
updated: 2026-10-09
pr: https://github.com/victoriaxleigh/lovewords/pull/43
branch: claude/word-requests (merged as 1e01bfd)
---

# Handoff: word requests (PR #43)

You are picking up a finished feature that has **not shipped**. Your job is to
verify it, get it deployed safely, and confirm it works in production. Read
`AGENTS.md` first; its production database rules override anything here.

## What the feature does

1. A player's word is rejected → the error banner offers **Ask to add WORD 📖**.
2. The request is stored once per (word, player). The first request for a word
   pushes to the reviewers (and emails them if `RESEND_API_KEY` is set).
3. Reviewers (accounts in `WORD_ADMIN_EMAILS`) see **Settings → Word requests**,
   with each word's request count and an NWL badge, and tap **Add word** or
   **Reject**.
4. **Add word** writes to `added_words`. Every app merges that list into its
   dictionary when a game screen opens, and `game-solve` / `game-coach` merge it
   into the solver. Everyone who asked gets a push "✨ WORD is a word now!".
   Rejections notify nobody.
5. The NWL badge reads "NWL not checked yet" until a licensed list is saved as
   `netlify/functions/lib/nwl.txt.gz`. No licence exists yet; **do not** add the
   file or source NWL from anywhere.

Related, already shipped: PR #42 added ~2,400 words to
`src/engine/wordSupplement.json` (SCOWL + hand-picked; notice in
`docs/licenses/SCOWL.txt`).

## Files

| Area | Files |
|---|---|
| Migration | `supabase/migrations/20261009000100_word_requests.sql` (mirrored in `supabase_schema.sql`) |
| Function | `netlify/functions/word-requests.js`, routed in `netlify.toml` at `/api/word-requests` |
| Server libs | `netlify/functions/lib/addedWords.js`, `lib/nwl.js`, `lib/userPush.js`; `addWords` in `lib/dictionary.js` |
| Solver hooks | `loadAddedWords` before `solveGame` in `game-solve.js` and `game-coach.js` |
| App | `src/supabase/wordRequests.ts`, `addWords` in `src/engine/dictionary.ts`, `src/screens/WordRequestsScreen.tsx`, banner in `GameScreen.tsx`, row in `SettingsScreen.tsx`, route in `App.tsx` |
| Tests | `__tests__/wordRequestsHandler.test.ts`, `dictionary.test.ts`, `solveHandler.test.ts` (routes the new `added_words` read) |
| Docs | `DEPLOY.md` §2 (env var), §3 (migration), §7 (operating notes); `CHANGELOG.md` |

## Checks, in order

Tick each box in this file as you go and push the update, so the next agent
knows where you stopped. **Stop and ask the owner** wherever it says so; don't
work around it.

### 1. Branch is current and green

- [x] `git fetch origin && git checkout claude/word-requests`
- [x] If `main` moved, merge it in (`git merge origin/main`; no rebase or force
      push). Resolve conflicts, regenerate lockfiles with npm, never by hand.
- [x] `npm ci`
- [x] `npx jest`: expect all suites to pass (521 tests at handoff).
- [x] `npx tsc --noEmit`: expect a clean exit.
- [x] Netlify deploy preview on the PR built successfully.

### 2. Review the diff yourself

Read `git diff origin/main...HEAD` adversarially. At minimum confirm:

- [x] `word_requests` has no grant or policy for `anon`/`authenticated`;
      `added_words` is select-only for them. Only `service_role` writes either.
- [x] Reviewer checks happen server-side in `word-requests.js` (`isReviewer`)
      before list and review. The app only hides the Settings row.
- [x] Words are validated as `^[A-Z]{2,15}$` on the server and by the table
      `check` constraints.
- [x] Every push/email path is awaited and can't fail the request
      (`lib/userPush.js` never throws).
- [x] `notify.js` is unchanged (`git diff origin/main...HEAD -- netlify/functions/notify.js` is empty).

### 3. Preview check (no backend)

- [x] `npx expo start --web`, open `/?dev=1` at about 375px wide.
- [x] Settings shows **Word requests 📖, 2 words waiting** (dev fixture).
      Open it, tap **Add word** on one card, and confirm it disappears.
- [x] In a game, play a non-word → banner shows **Ask to add …** → tap →
      "… requested 📬" plus the thank-you line. (The dev dictionary falls back
      to accepting everything if ENABLE can't download; if so, note it and move on.)

> **Progress (2026-10-09):** steps 1–3 done. 38 suites / 521 tests pass,
> `tsc` clean, diff review found no blockers. Preview at 375px: Settings row,
> review screen and **Add word**, and the **Ask to add** banner all work as
> described. Stopped at step 4: the cloud session had no Supabase network
> access or credentials, so the owner is running the migration locally.

### 4. Production database (owner approval needed)

`AGENTS.md` rules apply in full. You need the linked Supabase CLI; if this
environment isn't linked or has no credentials, **stop and ask the owner** to
run these steps or provide access. Never use the SQL Editor, `--include-all`
or migration repair without explicit owner approval.

- [x] `npx supabase migration list --linked`: local and remote match up to
      `20261007000200_game_coach_notes`. If remote has anything unrecorded,
      **stop** and reconcile with the owner.
- [x] `npx supabase db push --linked --dry-run`: the **only** pending
      migration is `20261009000100_word_requests.sql`. Anything else → stop.
- [x] Show the owner the dry-run output and get a go-ahead.
- [x] `npx supabase db push --linked --yes`
- [x] `npx supabase migration list --linked`: local and remote match.

### 5. Netlify environment (owner)

- [x] `WORD_ADMIN_EMAILS` = the owner's sign-in email (comma-separate extras),
      scope **Functions** (plus Runtime), not Post-processing. See `DEPLOY.md` §2.
- [x] Confirm `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and the VAPID keys are
      already set (they power existing features).
- [ ] Optional: `RESEND_API_KEY` for reviewer emails.

> **Progress (2026-10-09, later):** migration `20261009000100` applied by the
> owner after a clean `migration list` and a dry run showing only that file;
> the review screen reading `word_requests` confirms it is live.
> `WORD_ADMIN_EMAILS` set for all contexts (Functions + Runtime); Resend not
> set. Tested on Deploy Preview #43 (which uses the production database):
> Settings row, request, reject, approve and both pushes work. Pushes go to
> the one device an account last registered (`push_subscriptions` is one row
> per user), so test on that device. Test words SZDD and SGD were approved, then
> deleted from `added_words` by the owner. Still to do: a
> non-reviewer account must not see the row; then steps 6–8.

### 6. Merge and deploy

- [x] Only after steps 1–5: merge PR #43 with a merge commit. (Merged 2026-10-09 as `1e01bfd`.)
- [ ] Wait for the Netlify production deploy to publish. If the env var was set
      after the build started, trigger a redeploy.

### 7. Production verification

- [x] Wiring: `curl -i https://lovewords1234.netlify.app/api/word-requests`
      → **401 "Missing Authorization header"**. A 500 "not configured" means
      `SUPABASE_*` isn't Functions-scoped.
- [x] Owner account (notifications enabled in the app): Settings shows the
      **Word requests** row. Another account must **not** see it.
- [ ] From a second account, play a made-up word (e.g. ZXQWV) and tap **Ask
      to add**. Owner gets the "📖 New word request" push (and email if Resend
      is set). Asking again from the same account sends nothing new.
- [x] Owner opens Word requests: the word shows "Asked by 1 player" and "NWL
      not checked yet". **Reject** it; the card disappears and the requester
      gets no push. Confirm the word is still rejected in a game.
- [x] Repeat with a second made-up word and **Add word**. The requester gets
      "✨ … is a word now!". Reopen the game screen and the word is accepted.
- [x] Clean up the test words: ask the owner before deleting the approved test
      word from `added_words` (Table Editor row delete, not SQL). A warm
      function container may keep accepting it for up to its lifetime; that's
      expected.
- [ ] Netlify → Functions → `word-requests`, `game-solve`, `game-coach` logs show
      no Supabase/Postgres errors for these invocations.
- [x] Because this feature sends push, also do one production **Nudge** on a
      two-player game and confirm ✅ Nudged! with a clean `notify` log, as
      `AGENTS.md` asks after notification-adjacent changes.

> **Shipped (2026-10-09):** owner confirmed the production wiring check, the
> Settings row, and a production Nudge. Request, reject, approve, both pushes
> and test-word cleanup were verified on the deploy preview, which uses the
> production database. Not done: the second-account checks (another account
> not seeing the row; a push to a different requester) and a read of the
> function logs; the owner tested from one account. Both are low risk: the
> server refuses non-reviewers (403), and pushes were confirmed working.

### 8. Close out

- [x] Update `AGENT_HANDOFF.md`'s "Last updated" block with what shipped.
- [x] Set `status: shipped` in this file's front matter.
- [x] Report back to the owner: what you verified, anything skipped and why.

## Rollback

- Code: Netlify → Deploys → publish the previous deploy, or revert the merge on
  `main`. The migration is additive; leaving the tables in place is safe.
- A wrongly approved word: delete its row from `added_words` (owner approval).
  Apps drop it on their next launch; solver containers within minutes to hours.

## Known limits (not bugs)

- Players without notifications enabled aren't told their word was added; it
  just starts working.
- No in-app way to undo an approval; see Rollback.
- The NWL check is inert until a licensed `nwl.txt.gz` exists. Its licensing
  terms (NASPA, info@scrabbleplayers.org) are the owner's to arrange; check
  whether the licence allows committing the file to this repo.
- Rejected words come back when a different player asks, and reviewers get
  pushed again; the same player re-asking after a rejection sees "requested"
  though nothing is stored. Details and two smaller ones in `ISSUES.md` →
  "Known limitations — word requests".
- `lib/userPush.js` duplicates the two small push senders from `notify.js` on
  purpose, to keep the notification claim path untouched.
