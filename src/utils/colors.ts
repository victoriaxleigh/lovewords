import type { GameMode } from '../types';

export const Colors = {
  // Brand — beige-berry neutrals with pops of berry, hardened for WCAG 2.1 AAA
  // (7:1 for normal text, 4.5:1 for large). One brand colour (berry) used sparingly;
  // everything else is warm neutral (beige-berry page, greige, near-black, white).
  //   primary     #7A1F4A — berry: the one CTA fill (white label 9.89:1), the
  //                         heart, unread dots; berry text on white 9.89:1.
  //   primaryDark #5C1438 — deep berry TEXT on the page bg / tilePlaced (titles,
  //                         links, initials): 10.9:1 on page, 9.25:1 on tilePlaced.
  //   textLight   #55454B — secondary text on white (8.98:1) and the page bg
  //                         (7.53:1). Do NOT place it on tilePlaced (6.38:1).
  //   errorDark   #9B1C1C — error text + delete button (white on it 8.2:1).
  // Game modes are told apart by wording and label, with a light touch of colour —
  // see `modeAccent` below.
  primary: '#7A1F4A',
  primaryLight: '#E3B8C4',
  primaryDark: '#5C1438',
  accent: '#7A1F4A', // berry — unread dots and badges (carries no text)
  background: '#F3E9E7',
  surface: '#FFFFFF',
  text: '#1E1A1D',
  textLight: '#55454B',
  errorDark: '#9B1C1C',
  border: '#908078', // 3:1 on white and the page bg (non-text UI)

  // Partner mode accent — berry (white label 9.89:1; berry text on page bg 8.3:1).
  // partnerChip is its light fill for avatars and chips (partnerDark text 9.7:1).
  partner: '#7A1F4A',
  partnerDark: '#5C1438',
  partnerChip: '#F0D9E0',

  // Friend mode accent — greige (white label 7.08:1 on it).
  friend: '#5F5750',
  friendChip: '#E4DDD6',

  // Board colors
  boardBg: '#1E1418',
  emptyCell: '#33252B',
  tileDefault: '#FFFFFF',
  tileText: '#1E1A1D',
  tileSelected: '#E3B8C4',
  tilePlaced: '#E8D5D6',

  // Bonus squares — warm = word, cool = letter; darker = triple, lighter = double.
  // TW/TL/START carry SOLID white labels; DW/DL carry SOLID dark text.
  tw: '#7A1F4A',   // triple word — berry       (white label 9.89:1)
  dw: '#E3B8C4',   // double word — soft berry  (dark label 9.76:1)
  tl: '#5F5750',   // triple letter — greige    (white label 7.08:1)
  dl: '#D9D0C8',   // double letter — light greige (dark label 11.31:1)
  start: '#33252B', // star center — berry black (white label 14.58:1)

  // Action buttons — Swap and Pass are neutral outlines; their labels differ,
  // so they don't need different hues. Text hits WCAG AAA on the white fill and
  // borders hit the non-text 3:1 bar on both the fill and the page bg.
  swapBg: '#FFFFFF',
  swapBorder: '#1E1A1D',
  swapText: '#1E1A1D',
  passBg: '#FFFFFF',
  passBorder: '#5F5750',
  passText: '#1E1A1D',

  // Status
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
};

/**
 * The accent a game uses for its own moments: love notes / messages, and the
 * double-word squares. Partner games are berry, friend games are greige. Always
 * pair `fill` with `onFill` for text, and `chip` with `onChip`.
 */
export function modeAccent(mode: GameMode | undefined) {
  if (mode === 'friend') {
    return {
      fill: Colors.friend,
      onFill: '#FFFFFF',
      chip: Colors.friendChip,
      onChip: Colors.text,
    };
  }
  return {
    fill: Colors.partner,
    onFill: '#FFFFFF',
    chip: Colors.partnerChip,
    onChip: Colors.partnerDark,
  };
}

/** Double-word square colour: soft berry in both modes (dark label). */
export function doubleWordColor(mode: GameMode | undefined): string {
  void mode;
  return Colors.dw;
}
