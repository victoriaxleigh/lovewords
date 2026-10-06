import { shortName } from '../src/utils/displayName';

describe('shortName', () => {
  it('shows first name and last initial', () => {
    expect(shortName('Tom Dugan')).toBe('Tom D.');
    expect(shortName('Victoria Parisi')).toBe('Victoria P.');
  });

  it('uses the last word as the surname when there are several', () => {
    expect(shortName('Mary Jane Watson')).toBe('Mary W.');
  });

  it('uppercases the initial and ignores extra whitespace', () => {
    expect(shortName('  ana   de la cruz ')).toBe('ana C.');
  });

  it('leaves single names alone', () => {
    expect(shortName('Shawn')).toBe('Shawn');
  });

  it('handles empty or missing names', () => {
    expect(shortName('')).toBe('');
    expect(shortName(undefined)).toBe('');
    expect(shortName(null)).toBe('');
  });
});
