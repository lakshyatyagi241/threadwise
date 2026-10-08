import { describe, expect, it } from 'vitest';
import { setStoreGroupCodeSchema } from '@crm/contracts';
import {
  GROUP_CODE_MAX,
  isGroupCodeDirty,
  normaliseGroupCode,
  orderingLink,
  validateGroupCode,
} from './group-code';

describe('validateGroupCode', () => {
  it('accepts letters, digits, dot, dash and underscore', () => {
    expect(validateGroupCode('ACME-1.b_c')).toEqual({ ok: true, value: 'ACME-1.b_c' });
  });

  it('trims and treats blank as clearing the code', () => {
    expect(validateGroupCode('  ACME ')).toEqual({ ok: true, value: 'ACME' });
    expect(validateGroupCode('')).toEqual({ ok: true, value: null });
    expect(validateGroupCode('   ')).toEqual({ ok: true, value: null });
  });

  it('refuses spaces inside, symbols and non-latin letters', () => {
    for (const bad of ['AC ME', 'ACME!', 'مرحبا', 'a/b', 'a@b']) {
      expect(validateGroupCode(bad), bad).toEqual({ ok: false, problem: 'badChars' });
    }
  });

  it('allows exactly 48 characters and refuses 49', () => {
    expect(validateGroupCode('a'.repeat(GROUP_CODE_MAX)).ok).toBe(true);
    expect(validateGroupCode('a'.repeat(GROUP_CODE_MAX + 1))).toEqual({
      ok: false,
      problem: 'tooLong',
    });
  });

  it('agrees with the contract the server enforces', () => {
    for (const text of ['ACME', 'a b', 'x'.repeat(49), '', 'ok_1']) {
      const mine = validateGroupCode(text).ok;
      const theirs = setStoreGroupCodeSchema.safeParse({ groupCode: text }).success;
      expect(mine, text).toBe(theirs);
    }
  });
});

describe('isGroupCodeDirty', () => {
  it('is false when the text equals the saved code or both are empty', () => {
    expect(isGroupCodeDirty('ACME', 'ACME')).toBe(false);
    expect(isGroupCodeDirty(' ACME ', 'ACME')).toBe(false);
    expect(isGroupCodeDirty('', null)).toBe(false);
  });
  it('is true when it differs, including clearing a saved code', () => {
    expect(isGroupCodeDirty('NEW', 'ACME')).toBe(true);
    expect(isGroupCodeDirty('', 'ACME')).toBe(true);
    expect(isGroupCodeDirty('ACME', null)).toBe(true);
  });
  it('normalise trims', () => {
    expect(normaliseGroupCode('  x ')).toBe('x');
  });
});

describe('orderingLink', () => {
  it('points at the bot number with the pre-typed order text', () => {
    expect(orderingLink('919876543210', 'ACME')).toBe(
      'https://wa.me/919876543210?text=ORDER%20G%3AACME',
    );
  });
  it('is null without a number or a code', () => {
    expect(orderingLink(null, 'ACME')).toBeNull();
    expect(orderingLink('919876543210', null)).toBeNull();
    expect(orderingLink('', 'ACME')).toBeNull();
  });
  it('keeps digits only of the number', () => {
    expect(orderingLink('+91 98765', 'A')).toBe('https://wa.me/9198765?text=ORDER%20G%3AA');
  });
});
