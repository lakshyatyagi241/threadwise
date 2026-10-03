import { describe, expect, it } from 'vitest';
import { healthReasons, scoreTone, showHealth } from './health';

const sample = (over: Partial<Parameters<typeof healthReasons>[0]> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Tee',
  sku: null,
  imageUrl: 'https://x/y.png',
  priceMinor: 1000,
  metaSyncStatus: null,
  ...over,
});

describe('scoreTone', () => {
  it('cuts at 90 and 70', () => {
    expect(scoreTone(100)).toBe('good');
    expect(scoreTone(90)).toBe('good');
    expect(scoreTone(89)).toBe('warn');
    expect(scoreTone(70)).toBe('warn');
    expect(scoreTone(69)).toBe('bad');
    expect(scoreTone(0)).toBe('bad');
  });
});

describe('healthReasons', () => {
  it('lists no image, no price and a failed push in that order', () => {
    expect(
      healthReasons(sample({ imageUrl: null, priceMinor: 0, metaSyncStatus: 'failed' })),
    ).toEqual(['noImage', 'noPrice', 'syncError']);
  });
  it('treats an empty image url as missing and a healthy row as clean', () => {
    expect(healthReasons(sample({ imageUrl: '' }))).toEqual(['noImage']);
    expect(healthReasons(sample())).toEqual([]);
  });
});

describe('showHealth', () => {
  const base = { noImage: 0, noPrice: 0, errored: 0, flagged: 0, samples: [] };
  it('hides the card when there are no products', () => {
    expect(showHealth({ ...base, score: null, total: 0 })).toBe(false);
    expect(showHealth({ ...base, score: 80, total: 10 })).toBe(true);
  });
});
