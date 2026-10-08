import { describe, expect, it } from 'vitest';
import { tileMatches } from './tile-search';

describe('tileMatches (WD-ASHELL-008)', () => {
  const text = 'Analytics Google Analytics, Meta pixel, trackers';
  it('keeps everything for a blank box', () => {
    expect(tileMatches(text, '')).toBe(true);
    expect(tileMatches(text, '   ')).toBe(true);
  });
  it('matches a fragment in any case', () => {
    expect(tileMatches(text, 'ana')).toBe(true);
    expect(tileMatches(text, 'PIXEL')).toBe(true);
  });
  it('needs every word, in any order', () => {
    expect(tileMatches(text, 'pixel meta')).toBe(true);
    expect(tileMatches(text, 'pixel stripe')).toBe(false);
  });
  it('drops a tile with no match', () => {
    expect(tileMatches('Mail SMTP sender', 'ana')).toBe(false);
  });
});
