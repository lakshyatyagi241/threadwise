import { describe, expect, it } from 'vitest';
import { initials, isPhoneLike } from './initials';

describe('initials', () => {
  it('takes the first letter of the first and last word, upper-cased', () => {
    expect(initials('asha rao')).toBe('AR');
    expect(initials('Asha Kumari Rao')).toBe('AR');
  });
  it('cleans punctuation off each word first', () => {
    expect(initials('Dr. Asha')).toBe('DA');
  });
  it('gives one letter for one word and a question mark for nothing usable', () => {
    expect(initials('Asha')).toBe('A');
    expect(initials('  ')).toBe('?');
    expect(initials(null)).toBe('?');
    expect(initials('---')).toBe('?');
  });
  it('gives the same mark for any phone number, never a slice of the digits', () => {
    expect(initials('+91 92184 67176')).toBe('#');
    expect(isPhoneLike('+91 92184 67176')).toBe(true);
    expect(isPhoneLike('Room 12')).toBe(false);
  });
});
