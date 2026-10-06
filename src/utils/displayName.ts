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

// shortName for a list of people shown together, such as the Stats opponent rows or the lobby
// game cards. When two different names would shorten to the same thing ("Tom Dugan" and
// "Tom Davis" are both "Tom D."), those names are shown in full so the rows can be told apart.
export function shortNamesFor(names: (string | undefined | null)[]): (name: string | undefined | null) => string {
  const tidy = (name: string | undefined | null) => (name ?? '').trim().replace(/\s+/g, ' ');
  const fullNamesByShort = new Map<string, Set<string>>();
  for (const name of names) {
    const full = tidy(name);
    const short = shortName(full);
    if (!short) continue;
    if (!fullNamesByShort.has(short)) fullNamesByShort.set(short, new Set());
    fullNamesByShort.get(short)!.add(full);
  }
  return (name) => {
    const short = shortName(name);
    return (fullNamesByShort.get(short)?.size ?? 0) > 1 ? tidy(name) : short;
  };
}
