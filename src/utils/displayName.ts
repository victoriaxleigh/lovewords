// "Tom Dugan" -> "Tom D." Shows first name + last initial everywhere a player's name is
// displayed, so long names never crowd headers, score rows or banners. Single names pass
// through unchanged. Accessibility labels keep the full name (screen readers have room).

// Generational suffixes are skipped so "John Smith Jr." becomes "John S.", not "John J.".
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export function shortName(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  // The surname is the last word that starts with a letter. When there isn't one, as in
  // solo mode's built-in "Player 2 🎯" or "Tom 🐻", the name is shown whole.
  const surname = parts
    .slice(1)
    .reverse()
    .find((part) => /^\p{L}/u.test(part) && !SUFFIXES.has(part.toLowerCase().replace(/\.$/, '')));
  if (!surname) return parts.join(' ');
  // Spread rather than charAt(0) so an initial outside the BMP isn't split in half.
  return `${parts[0]} ${[...surname][0].toUpperCase()}.`;
}
