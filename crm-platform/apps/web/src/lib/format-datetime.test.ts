import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format-datetime';
import { initials } from './initials';

describe('formatDate / formatDateTime', () => {
  const at = '2026-10-08T17:14:00Z';
  it('reads the same in every screen: medium date, short time', () => {
    expect(formatDate(at, 'en', 'UTC')).toBe('Oct 8, 2026');
    expect(formatDateTime(at, 'en', 'UTC')).toMatch(/^Oct 8, 2026,\s5:14\sPM$/);
  });
  it('follows the zone', () => {
    expect(formatDate('2026-10-08T22:30:00Z', 'en', 'Asia/Kolkata')).toBe('Oct 9, 2026');
    expect(formatDateTime(at, 'en', 'America/New_York')).toMatch(/1:14\sPM/);
  });
  it('follows the language', () => {
    expect(formatDate(at, 'de', 'UTC')).toBe('08.10.2026');
  });
  it('is empty for nothing usable', () => {
    expect(formatDate(null, 'en')).toBe('');
    expect(formatDateTime(undefined, 'en')).toBe('');
    expect(formatDateTime('not a date', 'en')).toBe('');
    expect(formatDate('', 'en')).toBe('');
  });
});

describe('initials', () => {
  it('uses the first letter of the first and the last word', () => {
    expect(initials('Asha Verma')).toBe('AV');
    expect(initials('  ana  maria  lopez ')).toBe('AL');
  });
  it('gives one letter for one word and a question mark for nothing', () => {
    expect(initials('madonna')).toBe('M');
    expect(initials('   ')).toBe('?');
    expect(initials(null)).toBe('?');
  });
  it('cleans punctuation off the words', () => {
    expect(initials('Dr. Asha')).toBe('DA');
    expect(initials('+ab')).toBe('A');
  });
  it('gives # to a name that is only a phone number', () => {
    expect(initials('+91 98765 43210')).toBe('#');
    expect(initials('+918858734844')).toBe('#');
  });
});
