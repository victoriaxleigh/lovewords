import {
  buildRecoveryRedirect,
  getLaunchAuthRedirect,
  MIN_PASSWORD_LENGTH,
  parseAuthRedirect,
  validateNewPassword,
} from '../src/utils/passwordRecovery';

describe('parseAuthRedirect', () => {
  test('recognises an implicit-flow recovery callback in the fragment', () => {
    expect(
      parseAuthRedirect(
        'https://lovewords1234.netlify.app/#access_token=abc&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'
      )
    ).toEqual({ recovery: true, error: null });
  });

  test('recognises a bare ?dev=1 recovery link from the mock', () => {
    expect(parseAuthRedirect('http://localhost:8081/?dev=1#type=recovery')).toEqual({
      recovery: true,
      error: null,
    });
  });

  test('recognises type=recovery in the query string', () => {
    expect(parseAuthRedirect('https://example.com/?code=xyz&type=recovery').recovery).toBe(true);
  });

  test('does not treat other callback types or plain URLs as recovery', () => {
    expect(parseAuthRedirect('https://example.com/#access_token=a&type=signup').recovery).toBe(false);
    expect(parseAuthRedirect('https://example.com/?invite=LOVE2345')).toEqual({
      recovery: false,
      error: null,
    });
    expect(parseAuthRedirect('')).toEqual({ recovery: false, error: null });
    expect(parseAuthRedirect('not a url')).toEqual({ recovery: false, error: null });
  });

  test('turns an expired-link redirect into a user-facing error', () => {
    const result = parseAuthRedirect(
      'https://example.com/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    expect(result.recovery).toBe(false);
    expect(result.error).toMatch(/expired or was already used/);
  });

  test('gives a generic message for other link errors', () => {
    expect(parseAuthRedirect('https://example.com/?error=server_error').error).toMatch(
      /invalid or has expired/
    );
  });

  test('captures nothing at launch outside a browser', () => {
    expect(getLaunchAuthRedirect()).toEqual({ recovery: false, error: null });
  });
});

describe('buildRecoveryRedirect', () => {
  test('returns the current page without fragment or unrelated params', () => {
    expect(buildRecoveryRedirect('https://lovewords1234.netlify.app/?invite=LOVE2345#x=1')).toBe(
      'https://lovewords1234.netlify.app/'
    );
  });

  test('keeps ?dev=1 so the link lands back on the mock client', () => {
    expect(buildRecoveryRedirect('http://localhost:8081/?dev=1&foo=bar')).toBe(
      'http://localhost:8081/?dev=1'
    );
  });

  test('falls back to the production web app off-browser', () => {
    expect(buildRecoveryRedirect(null)).toBe('https://lovewords1234.netlify.app/');
    expect(buildRecoveryRedirect('garbage')).toBe('https://lovewords1234.netlify.app/');
  });
});

describe('validateNewPassword', () => {
  test('requires both fields', () => {
    expect(validateNewPassword('', '')).not.toBeNull();
    expect(validateNewPassword('secret1', '')).not.toBeNull();
  });

  test('enforces the minimum length', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword(short, short)).toMatch(/at least/);
  });

  test('requires the confirmation to match', () => {
    expect(validateNewPassword('secret12', 'secret13')).toMatch(/match/);
  });

  test('accepts a matching password of sufficient length', () => {
    expect(validateNewPassword('secret12', 'secret12')).toBeNull();
  });
});
