// "Tom Dugan" -> "Tom D." Shows first name + last initial everywhere a player's name is
// displayed, so long names never crowd headers, score rows or banners. Single names pass
// through unchanged. Accessibility labels keep the full name (screen readers have room).
export function shortName(name: string | undefined | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}
