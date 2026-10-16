import { describe, expect, it } from 'vitest';
import { badCell } from '../load/engine';
import { cutText } from '../util';

/** A text cut by character count must never end in half an emoji (Postgres refuses it inside JSON, SQLSTATE 22P02), and a row that still holds one is named before the insert. */
describe('cutText', () => {
  it('keeps short text and plain cuts as they are', () => {
    expect(cutText('hello', 10)).toBe('hello');
    expect(cutText('hello world', 5)).toBe('hello');
  });
  it('does not leave half of an emoji at the cut', () => {
    const s = 'ab😀cd'; // the emoji is two UTF-16 units at index 2 and 3
    expect(cutText(s, 3)).toBe('ab'); // a plain slice(0, 3) would end in a lone high surrogate
    expect(cutText(s, 4)).toBe('ab😀');
    expect(cutText('😀'.repeat(300), 200)).toBe('😀'.repeat(100));
  });
});

describe('badCell', () => {
  it('names half an emoji in text and in json, accepts whole ones', () => {
    expect(badCell('text', 'ab😀')).toBeNull();
    expect(badCell('text', 'ab\ud83d')).toMatch(/lone surrogate/);
    expect(badCell('jsonb', { a: ['x', { b: 'q\ude00' }] })).toMatch(/lone surrogate/);
    expect(badCell('jsonb', { a: ['x', '😀'] })).toBeNull();
  });
  it('checks the other column types', () => {
    expect(badCell('uuid', 'not-a-uuid')).toMatch(/uuid/);
    expect(badCell('uuid', '123e4567-e89b-42d3-a456-426614174000')).toBeNull();
    expect(badCell('bigint', 1.5)).toMatch(/whole/);
    expect(badCell('bigint', '42')).toBeNull();
    expect(badCell('timestamptz', 'yesterday')).toMatch(/ISO/);
    expect(badCell('timestamptz', '2026-10-15T12:00:00.000Z')).toBeNull();
    expect(badCell('timestamptz', null)).toBeNull();
  });
});
