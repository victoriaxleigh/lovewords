# LoveWords — App Store submission kit

Everything you paste into App Store Connect for the v1.0 (free) submission.
Character limits are Apple's; drafts below stay within them.

---

## App information

| Field | Value |
|---|---|
| **App name** (≤30 chars) | `LoveWords: Word Game` |
| **Subtitle** (≤30 chars) | `Play words with your people` |
| **Primary category** | Games |
| **Subcategory** | Word |
| **Secondary category** (optional) | Board |
| **Bundle ID** | `com.lovewords.app` |
| **Price** | Free (v1.0) |

---

## Promotional text (≤170 chars — editable anytime, no review)

> A cozy word game for two. Challenge your partner or a friend, send notes between
> moves, and talk a little smack. Your turn awaits. 💕

---

## Description (≤4000 chars)

> **LoveWords is a word game made for two.**
>
> Play a relaxed, turn-based word game with the people you actually care about —
> your partner, your best friend, your sister. Build words on the board, rack up
> points, and keep the banter going between moves.
>
> **Two ways to play:**
> • **Partner mode** — the romantic experience, with sweet love notes and playful
>   flirting built in.
> • **Friend mode** — same great game, with fun word-nerd banter instead.
>
> **Features:**
> • Classic 15×15 word board with double/triple letter and word bonuses
> • Turn-based play — take your turn whenever you like, no pressure
> • In-game notes & messages so the conversation never stops
> • Playful smack talk when someone pulls ahead
> • Solo practice mode to sharpen your game
> • Get a notification the moment it's your turn
> • Clean, friendly design — no clutter, no ads
>
> Invite someone by email, and you're playing in seconds. However far apart you
> are, LoveWords keeps you connected one word at a time.
>
> Made with love, for the people you love. 💕

---

## Keywords (≤100 chars, comma-separated, no spaces)

```
word game,words,scrabble,couples,friends,2 player,puzzle,vocabulary,board game,letters,tiles,crossword
```

---

## URLs

| Field | Value |
|---|---|
| **Privacy Policy URL** (required) | `https://lovewords1234.netlify.app/privacy.html` |
| **Support URL** (required) | `https://lovewords1234.netlify.app` (or a dedicated support page) |
| **Marketing URL** (optional) | `https://lovewords1234.netlify.app` |

⚠️ Before submitting, edit `public/privacy.html` and replace
`ADD-YOUR-CONTACT-EMAIL-HERE` with a real support email.

---

## App Privacy questionnaire (App Store Connect → App Privacy)

Answers for the "nutrition label." Note: **"Contacts"** (the phone address book)
is different from **"Contact Info"** (email/name you enter). LoveWords collects
Contact Info, never the address book.

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Contact Info — Email Address | ✅ Yes | Yes | No | App Functionality (account, invites) |
| Contact Info — Name (display name) | ✅ Yes | Yes | No | App Functionality |
| User Content — in-game messages/notes | ✅ Yes | Yes | No | App Functionality |
| Identifiers — push token | ✅ Yes | Yes | No | App Functionality (notifications) |
| Contacts (address book) | ❌ No | — | — | — |
| Location | ❌ No | — | — | — |
| Usage Data / Analytics | ❌ No | — | — | — |
| Advertising / Third-party ads | ❌ No | — | — | — |

- Overall answer to "Do you or your partners use data to **track** users?" → **No.**
- This yields a clean label: "Data Linked to You" (for functionality), **no**
  "Data Used to Track You."

---

## Age rating

Answer **No** to violence, mature/suggestive themes, etc. → likely **4+**.

⚠️ **One question needs care: user-generated content.** Players can send free-text
messages to each other. In v1.0 you can only message people you invited by email
(no strangers), which is low-risk, but Apple's questionnaire may ask about UGC.
Answer honestly. If Apple pushes back under Guideline 1.2, the standard fixes are:
a report mechanism, a block mechanism, and a content filter. **This becomes
mandatory once random matchmaking (Phase 2) ships**, since that pairs strangers —
plan to add block/report before then.

---

## Screenshots

Apple requires screenshots for at least the **6.9"/6.7" iPhone** display size
(1290×2796 or 1284×2778), 3–5 of them. The final, exact-resolution screenshots
are best captured from the built app in the **iOS Simulator** (Screenshots there
come out at the precise required size). Until the build exists, draft framing of
the key screens was reviewed during development — use the order/captions below.

Suggested screenshot order + captions:
1. Home screen — "Your games, all in one place"
2. New game modal — "Play with a partner or a friend"
3. Game board — "Build words, rack up points"
4. Messages/notes — "Keep the conversation going"
5. Finished game — "Winner takes the bragging rights"

---

## Review notes (paste into "Notes" for the reviewer)

> LoveWords is a two-player, turn-based word game. To test:
> 1. Create an account (any email + password).
> 2. Use "Practice Solo" from the New Game screen to try a full game without a
>    second account.
> 3. To test multiplayer, create a second account on another device/simulator and
>    invite it by email.
> The app is free with no in-app purchases in this version.

---

## Pre-submit checklist

- [ ] Apple Developer Program membership active
- [ ] `eas init` run (fills the real `projectId` in `app.json`)
- [ ] Privacy policy email placeholder replaced + site redeployed
- [ ] App icon has no alpha (done — `assets/icon-ios.png`)
- [ ] `eas build --platform ios --profile production` succeeds
- [ ] Screenshots uploaded at required size(s)
- [ ] App Store Connect app record created (name, bundle ID, category)
- [ ] `eas submit --platform ios` uploads the build
- [ ] Submit for review
