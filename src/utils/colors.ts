export const Colors = {
  // Brand — deep rose palette, hardened for WCAG 2.1 AAA (7:1 for normal text,
  // 4.5:1 for large). See src/utils/colors.contrast rationale in AGENT_HANDOFF.
  //   primary   #A8005F — fills behind white text (7.42:1) + primary-colored
  //                       text on white cards (scores, active tab) (7.42:1).
  //   primaryDark #7A0046 — primary-colored TEXT on light backgrounds (titles,
  //                       links, close buttons, avatar initials): ≥8.4:1 on the
  //                       pink bg / tilePlaced, ≥10.9:1 on white.
  //   textLight  #7A3453 — secondary text on white (8.6:1) and the pink page
  //                       bg (7.8:1). NOTE: do NOT place it on the tilePlaced
  //                       fill (only 6.6:1) — use primaryDark/text there.
  //   errorDark  #9B1C1C — error text + delete button (white on it 8.2:1).
  // The board's brighter `dw` pink is unchanged (it carries no text).
  primary: '#A8005F',
  primaryLight: '#FF6EB4',
  primaryDark: '#7A0046',
  accent: '#FF4081',
  background: '#FFF0F5',
  surface: '#FFFFFF',
  text: '#2D0A1E',
  textLight: '#7A3453',
  errorDark: '#9B1C1C',
  border: '#F0A8C8',

  // Board colors
  boardBg: '#1A0A12',
  emptyCell: '#2D1420',
  tileDefault: '#FFFFFF',
  tileText: '#2D0A1E',
  tileSelected: '#FF6EB4',
  tilePlaced: '#FFD6EC',

  // Bonus squares — deepened so their labels hit WCAG AAA (7:1).
  // TW/DW/TL/START carry SOLID white labels; DL carries SOLID dark text.
  tw: '#A01818',   // triple word — deep red   (white label 7.96:1)
  dw: '#A8005F',   // double word — deep rose  (white label 7.42:1)
  tl: '#124C8F',   // triple letter — deep blue (white label 8.56:1)
  dl: '#7DC2F7',   // double letter — light blue (dark label 8.07:1)
  start: '#8E1050', // star center — deep rose  (white label 8.97:1)

  // Status
  success: '#4CAF50',
  error: '#F44336',
  warning: '#FF9800',
};
