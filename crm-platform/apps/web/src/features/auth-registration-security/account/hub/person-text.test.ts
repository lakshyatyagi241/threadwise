import { describe, expect, it } from 'vitest';
import { firstNameOf, initialsOf } from './person-text';

describe('initialsOf', () => {
  it('takes the first letter of the first two words, upper-cased', () => {
    expect(initialsOf('Asha Rao')).toBe('AR');
    expect(initialsOf('asha rao menon')).toBe('AR');
    expect(initialsOf('  Lakshya   Tyagi  ')).toBe('LT');
  });

  it('uses one letter for a one-word name', () => {
    expect(initialsOf('Asha')).toBe('A');
  });

  it('falls back to a question mark when there is nothing to show', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });

  it('never splits a character that takes two UTF-16 units', () => {
    expect(initialsOf('😀 Nova')).toBe('😀N');
    expect(initialsOf('Élodie Önal')).toBe('ÉÖ');
  });
});

describe('firstNameOf', () => {
  it('is the first word', () => {
    expect(firstNameOf('Asha Rao')).toBe('Asha');
    expect(firstNameOf('  Asha   Rao ')).toBe('Asha');
    expect(firstNameOf('Asha')).toBe('Asha');
  });

  it('is empty when there is no name', () => {
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf(null)).toBe('');
  });
});
