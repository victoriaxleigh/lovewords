// Pure helpers for email/code invites. Kept free of React Native imports so it
// can be unit-tested in a plain node environment (see __tests__/invites.test.ts).

export const INVITE_CODE_LENGTH = 8;

// The production web origin, used for links built on native (which has no
// window.location) or in any non-browser context.
export const DEFAULT_INVITE_ORIGIN = 'https://lovewords1234.netlify.app';

// Strip formatting and upper-case so "love-2345", "LOVE 2345" and "love2345"
// all resolve to the same stored code.
export function normalizeInviteCode(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Display form: a single dash after the fourth character (e.g. LOVE-2345).
export function formatInviteCode(raw: string | null | undefined): string {
  const code = normalizeInviteCode(raw);
  if (code.length <= 4) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function isValidInviteCode(raw: string | null | undefined): boolean {
  return normalizeInviteCode(raw).length === INVITE_CODE_LENGTH;
}

function resolveOrigin(origin?: string): string {
  if (origin) return origin.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return DEFAULT_INVITE_ORIGIN;
}

// Build the shareable link that drops a newcomer onto the sign-up screen with
// the invite pre-filled: <origin>/?invite=CODE
export function buildInviteLink(rawCode: string, origin?: string): string {
  const code = normalizeInviteCode(rawCode);
  return `${resolveOrigin(origin)}/?invite=${encodeURIComponent(code)}`;
}

// Pull a code out of a full URL or a bare query string. Returns the normalized
// code when it's the right length, otherwise null.
export function parseInviteCodeFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]invite=([^&#]+)/.exec(url);
  if (!match) return null;
  let value = match[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    // Leave the raw value if it isn't valid percent-encoding.
  }
  const code = normalizeInviteCode(value);
  return code.length === INVITE_CODE_LENGTH ? code : null;
}

// Read the invite code from the current browser URL, if any (no-op on native).
export function getInviteCodeFromLocation(): string | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return parseInviteCodeFromUrl(window.location.href);
}
