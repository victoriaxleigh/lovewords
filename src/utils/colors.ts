import type { GameMode } from '../types';

export const Colors = {
  // Brand — deep teal palette, hardened for WCAG 2.1 AAA (7:1 for normal text,
  // 4.5:1 for large). See src/utils/colors.contrast rationale in AGENT_HANDOFF.
  //   primary   #0B5F5A — fills behind white text (7.50:1) + primary-colored
  //                       text on white cards (scores, active tab) (7.50:1).
  //   primaryDark #07423F — primary-colored TEXT on light backgrounds (titles,
  //                       links, close buttons, avatar initials): ≥8.8:1 on the
  //                       page bg / tilePlaced, ≥10.4:1 on white.
  //   textLight  #365A56 — secondary text on white (7.63:1) and the page bg
  //                       (7.04:1). NOTE: do NOT place it on the tilePlaced
  //                       fill (under 7:1) — use primaryDark/text there.
  //   errorDark  #9B1C1C — error text + delete button (white on it 8.2:1).
  // Partner games add a berry accent and friend games a coral one — see
  // `modeAccent` below. Berry never sits directly on a teal fill.
  primary: '#0B5F5A',
  primaryLight: '#7CCFC6',
  primaryDark: '#07423F',
  accent: '#F2937F', // coral — unread dots and badges (carries no text)
  background: '#F1F7F6',
  surface: '#FFFFFF',
  text: '#0F2422',
  textLight: '#365A56',
  errorDark: '#9B1C1C',
  border: '#A9CFCA',

  // Partner mode accent — berry (white label 8.75:1; berry text on page bg 8.07:1,
  // on white 8.75:1). partnerChip is its light fill for avatars and chips.
  partner: '#8C1D4E',
  partnerDark: '#6E123C',
  partnerChip: '#F6DCE6',

  // Friend mode accent — coral (dark `text` label 7.14:1 on it).
  friend: '#F2937F',

  // Board colors
  boardBg: '#0E2220',
  emptyCell: '#1B3835',
  tileDefault: '#FFFFFF',
  tileText: '#0F2422',
  tileSelected: '#7CCFC6',
  tilePlaced: '#CFE9E5',

  // Bonus squares — deepened so their labels hit WCAG AAA (7:1).
  // TW/DW/TL/START carry SOLID white labels; DL carries SOLID dark text.
  // DW is teal in friend games and berry (`partner`) in partner games; see
  // `doubleWordColor`.
  tw: '#9A2D1B',   // triple word — brick       (white label 7.59:1)
  dw: '#0B5F5A',   // double word — teal        (white label 7.50:1)
  tl: '#3B3FA0',   // triple letter — indigo    (white label 8.73:1)
  dl: '#F2C46B',   // double letter — gold      (dark label 10.16:1)
  start: '#07423F', // star center — deep teal  (white label 11.29:1)

  // Action buttons — Swap (blue) and Pass (amber) are tinted differently so they
  // can't be confused. Text hits WCAG AAA (7:1) on its own fill; borders hit the
  // non-text 3:1 bar (1.4.11) on both the fill and the page bg.
  //   swapText #0E3D74 on swapBg 9.59:1 · swapBorder 7.57:1 on fill
  //   passText #7A3600 on passBg 8.13:1 · passBorder 4.74:1 on fill
  swapBg: '#EAF2FB',
  swapBorder: '#124C8F',
  swapText: '#0E3D74',
  passBg: '#FFF3E0',
  passBorder: '#B25000',
  passText: '#7A3600',

  // Status
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
};

/**
 * The accent a game uses for its own moments: love notes / messages, and the
 * double-word squares. Partner games are berry, friend games are coral. Always
 * pair `fill` with `onFill` for text, and `chip` with `onChip`.
 */
export function modeAccent(mode: GameMode | undefined) {
  if (mode === 'friend') {
    return {
      fill: Colors.friend,
      onFill: Colors.text,
      chip: Colors.tilePlaced,
      onChip: Colors.primaryDark,
    };
  }
  return {
    fill: Colors.partner,
    onFill: '#FFFFFF',
    chip: Colors.partnerChip,
    onChip: Colors.partnerDark,
  };
}

/** Double-word square colour: berry in partner games, teal in friend games. */
export function doubleWordColor(mode: GameMode | undefined): string {
  return mode === 'friend' ? Colors.dw : Colors.partner;
}
