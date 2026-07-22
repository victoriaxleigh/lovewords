import { Colors } from '../src/utils/colors';

// WCAG contrast regression guard. The app targets AAA: 7:1 for normal text,
// 4.5:1 for large text (>=18.66px bold or >=24px). If someone lightens a brand
// color and drops a text pair below its threshold, these tests fail loudly.

function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#FFFFFF';
const ERROR_BANNER_BG = '#FFF0F0'; // hardcoded banner tint used across screens

// [label, foreground, background, minRatio]
const NORMAL_TEXT_AAA: [string, string, string][] = [
  ['white on primary fill (buttons/tabs/chips)', WHITE, Colors.primary],
  ['primary text on white (scores, active tab)', Colors.primary, Colors.surface],
  ['primaryDark text on white (titles, close)', Colors.primaryDark, Colors.surface],
  ['primaryDark text on pink bg (back link)', Colors.primaryDark, Colors.background],
  ['primaryDark on tilePlaced (avatar/pill)', Colors.primaryDark, Colors.tilePlaced],
  ['secondary text on white', Colors.textLight, Colors.surface],
  ['secondary text on pink bg', Colors.textLight, Colors.background],
  ['main text on white', Colors.text, Colors.surface],
  ['error text on banner tint', Colors.errorDark, ERROR_BANNER_BG],
  ['white on error/delete fill', WHITE, Colors.errorDark],
  // Board bonus-square labels (solid white / solid dark text)
  ['white on TW square', WHITE, Colors.tw],
  ['white on DW square', WHITE, Colors.dw],
  ['white on TL square', WHITE, Colors.tl],
  ['dark text on DL square', Colors.text, Colors.dl],
  ['white on START square', WHITE, Colors.start],
];

describe('WCAG AAA contrast (normal text, 7:1)', () => {
  test.each(NORMAL_TEXT_AAA)('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(7);
  });
});

describe('contrast helper sanity', () => {
  it('black on white is 21:1', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });
  it('is symmetric', () => {
    expect(contrast(Colors.primary, Colors.surface)).toBeCloseTo(
      contrast(Colors.surface, Colors.primary),
      5
    );
  });
});
