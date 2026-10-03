// Pure helpers for the forgot-password flow. Kept free of React Native imports
// so it can be unit-tested in a plain node environment (see
// __tests__/passwordRecovery.test.ts).
//
// A Supabase recovery email links back to the app as
// <redirectTo>#access_token=…&refresh_token=…&type=recovery. The Supabase client
// (detectSessionInUrl) consumes that fragment during its async initialisation,
// signs the user in and wipes the hash. If the app only looked at the session it
// would drop the user into the Lobby with no password set — so this module reads
// the URL synchronously at import time, and src/supabase/config.ts imports it
// before creating the client.

import { DEFAULT_INVITE_ORIGIN } from './invites';

// Supabase Auth's default minimum. The server enforces the real policy; this
// only saves a round trip for the obvious case.
export const MIN_PASSWORD_LENGTH = 6;

export type AuthRedirect = {
  // The URL is a password-recovery callback (type=recovery).
  recovery: boolean;
  // A user-facing message when Supabase redirected back with an error
  // (e.g. an expired or already-used link), otherwise null.
  error: string | null;
};

const NONE: AuthRedirect = { recovery: false, error: null };

function paramsOf(href: string): URLSearchParams[] {
  try {
    const url = new URL(href);
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    return [new URLSearchParams(hash), url.searchParams];
  } catch {
    return [];
  }
}

function readParam(all: URLSearchParams[], key: string): string | null {
  for (const params of all) {
    const value = params.get(key);
    if (value) return value;
  }
  return null;
}

// Looks at both the fragment (implicit flow, the default) and the query string
// (PKCE / error redirects) so either flow is recognised.
export function parseAuthRedirect(href: string | null | undefined): AuthRedirect {
  if (!href) return NONE;
  const all = paramsOf(href);
  if (all.length === 0) return NONE;

  const errorCode = readParam(all, 'error_code');
  const errorName = readParam(all, 'error');
  if (errorCode || errorName) {
    return { recovery: false, error: describeLinkError(errorCode) };
  }
  return { recovery: readParam(all, 'type') === 'recovery', error: null };
}

export function describeLinkError(errorCode: string | null): string {
  if (errorCode === 'otp_expired') {
    return 'That email link has expired or was already used. Request a new one below.';
  }
  return 'That email link is invalid or has expired. Request a new one below.';
}

// Where the recovery email should send the user back to: this page, without any
// stale fragment or params — except `dev`, so a ?dev=1 session stays on the mock.
// Native has no window.location, so it falls back to the production web app
// (the reset is completed in the browser; the user then signs in on the device).
export function buildRecoveryRedirect(href?: string | null): string {
  if (href) {
    try {
      const url = new URL(href);
      const out = new URL(url.origin + url.pathname);
      if (url.searchParams.has('dev')) out.searchParams.set('dev', url.searchParams.get('dev') ?? '');
      return out.toString();
    } catch {
      // Fall through to the production origin.
    }
  }
  return `${DEFAULT_INVITE_ORIGIN}/`;
}

// Returns an error message for the new-password form, or null when it's fine.
export function validateNewPassword(password: string, confirm: string): string | null {
  if (!password || !confirm) return 'Enter your new password twice';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password !== confirm) return "Those passwords don't match";
  return null;
}

function currentHref(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location?.href ?? null;
}

// Captured once, at module load — before the Supabase client can strip the hash.
const launchRedirect: AuthRedirect = parseAuthRedirect(currentHref());

export function getLaunchAuthRedirect(): AuthRedirect {
  return launchRedirect;
}

// Removes the auth fragment (and any error params) from the address bar once
// they've been handled, so a reload or a shared URL doesn't replay them.
// Leaves `dev` and every other query param alone.
export function clearAuthRedirectFromUrl(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    ['error', 'error_code', 'error_description', 'type', 'code'].forEach((key) =>
      url.searchParams.delete(key)
    );
    window.history.replaceState(window.history.state, '', url.toString());
  } catch {
    // Non-standard URL — leaving it is harmless.
  }
}
