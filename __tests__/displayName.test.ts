import { shortName, shortNamesFor } from '../src/utils/displayName';

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

  it('keeps names whole when no later word starts with a letter', () => {
    // Solo mode's built-in opponent name must keep its number and emoji intact.
    expect(shortName('Player 2 🎯')).toBe('Player 2 🎯');
    expect(shortName('Tom 🐻')).toBe('Tom 🐻');
  });

  it('skips emoji after the surname', () => {
    expect(shortName('Tom Dugan 🐻')).toBe('Tom D.');
  });

  it('never splits a surrogate pair in the initial', () => {
    expect(shortName('Ana 𝒵ed')).toBe('Ana 𝒵.');
  });

  it('skips generational suffixes', () => {
    expect(shortName('John Smith Jr.')).toBe('John S.');
    expect(shortName('Henry Ford III')).toBe('Henry F.');
  });

  it('handles empty or missing names', () => {
    expect(shortName('')).toBe('');
    expect(shortName(undefined)).toBe('');
    expect(shortName(null)).toBe('');
  });
});

describe('shortNamesFor', () => {
  it('shortens names that are unique in the list', () => {
    const display = shortNamesFor(['Tom Dugan', 'Alex Smith']);
    expect(display('Tom Dugan')).toBe('Tom D.');
    expect(display('Alex Smith')).toBe('Alex S.');
  });

  it('shows the full name when two different names would shorten the same', () => {
    const display = shortNamesFor(['Tom Dugan', 'Tom Davis', 'Alex Smith']);
    expect(display('Tom Dugan')).toBe('Tom Dugan');
    expect(display('Tom Davis')).toBe('Tom Davis');
    expect(display('Alex Smith')).toBe('Alex S.');
  });

  it('does not treat the same person appearing twice as a collision', () => {
    const display = shortNamesFor(['Tom Dugan', 'Tom Dugan', ' Tom  Dugan ']);
    expect(display('Tom Dugan')).toBe('Tom D.');
  });

  it('ignores empty names and keeps unshortenable names whole', () => {
    const display = shortNamesFor([undefined, null, '', 'Player 2 🎯']);
    expect(display('Player 2 🎯')).toBe('Player 2 🎯');
    expect(display(undefined)).toBe('');
  });
});
