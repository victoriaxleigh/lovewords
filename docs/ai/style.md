# LoveWords UI style guide

How the app looks and sounds, written for agents changing UI. It describes what is
already built. When this doc and the code disagree, the token files win:
`src/utils/colors.ts` (`Colors`) and `src/utils/styles.ts` (`RADII`, `SHADOWS`).

## Rules

- **Use the tokens.** Import `Colors`, `RADII` and `SHADOWS`; don't add new hex values
  or radii inline. If you need a colour that doesn't exist, add it to `colors.ts` with a
  comment saying what it sits on.
- **Contrast is tested.** Text meets WCAG AAA (7:1), and borders and other non-text UI
  meet 3:1. Every new text/background pair goes into `__tests__/contrast.test.ts`.
- **Light mode only.** `app.json` sets `userInterfaceStyle: "light"`. The board and rack
  are deliberately dark inside the light pink page; don't "fix" that.
- **System font only.** No custom fonts and no `fontFamily`.
- **Check at phone width** (about 375px) in `?dev=1` before calling UI work done.

## Colour

| Token | Hex | Use |
|---|---|---|
| `background` | #FFF0F5 | page background |
| `surface` | #FFFFFF | cards, sheets, inputs |
| `primary` | #A8005F | fills behind white text; primary-coloured text on white |
| `primaryDark` | #7A0046 | primary-coloured **text** on pink or `tilePlaced` (titles, links, initials) |
| `text` | #2D0A1E | body text |
| `textLight` | #7A3453 | secondary text on white or pink. **Not** on `tilePlaced` (fails AAA) |
| `border` | #F0A8C8 | borders, disabled button fill |
| `tilePlaced` | #FFD6EC | avatar/icon chips, selected pills |
| `errorDark` | #9B1C1C | error text, destructive buttons (white text on it) |
| `swap*` / `pass*` | blue / amber | Swap and Pass buttons only |
| `boardBg`, `emptyCell`, `tw` `dw` `tl` `dl` `start` | | board only |

White text on `primary` or `errorDark` is written as a literal `#fff` throughout. That's
fine, but prefer `Colors.surface` in new code.

**Patterns that don't have tokens yet.** Reuse these exact values rather than inventing
new ones; promoting them to tokens is welcome:

- Error banner: background `#FFF0F0`, border `#FFB3B3`, `errorDark` text, `RADII.md`.
- Success banner: background `#F0FFF4`, border `#A8E6B0`, text `#1E7B34`.
- Modal overlay: `rgba(0,0,0,0.5)`.

**Don't copy these.** They're known drift:

- `Colors.error` (#F44336) used as text. Use `errorDark`.
- A hardcoded `#FFF0F5`. Use `Colors.background`.
- `Colors.success` and `Colors.warning` are unused and not contrast-checked.

## Type

| Role | Size | Weight |
|---|---|---|
| captions, meta | 12 | 600 |
| body, buttons | 13–14 | 600–700 |
| primary button label | 15–17 | 700–800 |
| section and screen titles | 18–20 | 800 |
| scores | 28 | 800 |
| hero titles (auth logo, winner) | 34+ | 900 |

There's nothing below 600, so the UI reads bold and rounded; keep it that way. Use italic
for hints, empty states and subtitles. Use `letterSpacing` only for codes and uppercase
labels.

## Space and shape

- **Screen gutter:** `marginHorizontal: 16`.
- **Common padding:** 10/12 vertical and 14 horizontal for controls; 14–20 for cards and
  sheets.
- **Gaps:** 8, then 12.
- **Radii:** `RADII.md` (12) for buttons and inputs, `RADII.xl` (16) for panels, and 20 for
  pills and chips. 44px circles (radius 22) for avatars and round icon buttons.
- **Borders:** 1px `Colors.border`. Use 1.5px for outlined secondary buttons and for the
  highlighted "your turn" card.
- **Shadows:** `SHADOWS.card` on cards; `SHADOWS.btn` (pink glow) on primary CTAs only.

## Components

- **Primary button:** `primary` fill, `RADII.md`, 14–16 vertical padding, white
  700/800 label, `SHADOWS.btn`. When disabled, the fill becomes `border`.
- **Secondary button:** `surface` fill, 1px `border`, `text` label at 600/700. The outlined
  variant uses a 1.5px `primary` border with a `primaryDark` label.
- **Destructive button:** `errorDark` fill, white label.
- **Card or list row:** white, radius 14–18, padding 14, `SHADOWS.card`, with a 44px
  `tilePlaced` avatar circle on the left and a "›" chevron on the right where it navigates.
- **Pill:** radius 20, `primary` fill with white text when active, `background` fill
  otherwise.
- **Full modal:** `presentationStyle="pageSheet"`, a white header bar with a bottom border,
  a 20/800 `primaryDark` title and a text Cancel/close.
- **Dialog:** transparent fade modal with a white card (radius 16–24) and a `maxWidth`
  (340–420).
- **Headers:** no navigation header (`headerShown: false`). Each screen draws its own,
  with "← Back"-style text links.

## Icons and images

- **Icons are emoji in `<Text>`.** Hide decorative ones from screen readers
  (`accessibilityElementsHidden`) and put the meaning in the parent's `accessibilityLabel`.
  Mode emoji: 💕 partner, 🎲 friend, 🎯 solo.
- There's no icon library; don't add one for a single icon.
- **Pixel-art badges** live in `assets/achievements/<id>.png`: 64px, with `@2x`/`@3x`
  nearest-neighbour versions. On web, render them with `imageRendering: 'pixelated'` so the
  browser doesn't blur them. New pixel art should match their pink-and-gold palette.

## Copy

- Warm, playful and punny, with an emoji at the end of most strings. Word-game puns
  are on brand ("You're the Q to my U 💝", "Tile me impressed 👏").
- **Partner vs friend:** `GameMode` switches the wording. Partner is romantic ("Love
  Notes 💌", "💌 Note"); friend is teasing ("Messages 💬", "💬 Chat"). Any new copy that
  mentions the other player needs both versions.
- Smack talk can tease but never insult.
- Use sentence case for new labels ("New game", "Back to games").

## Layout

- No global web max-width: screens are full width, and modals and cards set their own
  `maxWidth`. Keep new screens readable at desktop width with a `maxWidth` on the content
  column.
- Size the board and rack from `useWindowDimensions` (see `BoardComponent.tsx`,
  `TileRack.tsx`).
- Lobby and Settings use `paddingTop: 56` in place of safe-area insets. Match it on new
  top-level screens.

`AGENT_HANDOFF.md` has the longer design history. Parts of it are out of date; trust
`colors.ts` over its `## Colors` section.
