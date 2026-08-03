import {
  INVITE_CODE_LENGTH,
  buildInviteLink,
  formatInviteCode,
  isValidInviteCode,
  normalizeInviteCode,
  parseInviteCodeFromUrl,
} from '../src/utils/invites';

describe('invite code helpers', () => {
  test('normalizes case, spaces, and dashes to a bare code', () => {
    expect(normalizeInviteCode('love-2345')).toBe('LOVE2345');
    expect(normalizeInviteCode('  LoVe 2345 ')).toBe('LOVE2345');
    expect(normalizeInviteCode(null)).toBe('');
    expect(normalizeInviteCode(undefined)).toBe('');
  });

  test('formats a dash after the fourth character for display', () => {
    expect(formatInviteCode('love2345')).toBe('LOVE-2345');
    expect(formatInviteCode('ABC')).toBe('ABC');
  });

  test('validates only full-length codes', () => {
    expect(INVITE_CODE_LENGTH).toBe(8);
    expect(isValidInviteCode('LOVE2345')).toBe(true);
    expect(isValidInviteCode('love-2345')).toBe(true);
    expect(isValidInviteCode('LOVE234')).toBe(false);
    expect(isValidInviteCode('')).toBe(false);
  });
});

describe('invite link building and parsing', () => {
  test('builds a link against the default origin with the normalized code', () => {
    expect(buildInviteLink('love-2345', 'https://example.com/')).toBe(
      'https://example.com/?invite=LOVE2345'
    );
    expect(buildInviteLink('LOVE2345')).toContain('/?invite=LOVE2345');
  });

  test('parses a code from a full URL or bare query string', () => {
    expect(parseInviteCodeFromUrl('https://x.app/?invite=LOVE2345')).toBe('LOVE2345');
    expect(parseInviteCodeFromUrl('https://x.app/?foo=1&invite=love2345#hash')).toBe('LOVE2345');
    expect(parseInviteCodeFromUrl('?invite=LOVE2345')).toBe('LOVE2345');
  });

  test('round-trips a built link back to its code', () => {
    const link = buildInviteLink('LOVE2345', 'https://x.app');
    expect(parseInviteCodeFromUrl(link)).toBe('LOVE2345');
  });

  test('rejects missing or wrong-length codes in a URL', () => {
    expect(parseInviteCodeFromUrl('https://x.app/?invite=SHORT')).toBeNull();
    expect(parseInviteCodeFromUrl('https://x.app/?other=1')).toBeNull();
    expect(parseInviteCodeFromUrl(null)).toBeNull();
  });
});
