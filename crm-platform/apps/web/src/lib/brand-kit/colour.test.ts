import { describe, expect, it } from 'vitest';
import {
  check,
  contrastRatio,
  ensureContrast,
  isHexColour,
  luminance,
  mix,
  parseHex,
  readableOn,
  toHex,
} from './colour';

describe('hex colours', () => {
  it('accepts only #RRGGBB', () => {
    for (const ok of ['#000000', '#FFFFFF', '#1a73e8', '#AbCdEf'])
      expect(isHexColour(ok)).toBe(true);
    for (const bad of [
      '',
      '#fff',
      '#12345',
      '#1234567',
      '1a73e8',
      'red',
      'rgb(0,0,0)',
      '#12345g',
      'url(x)',
      '#000000;background:red',
      '#000000\n',
      ' #000000',
      null,
      undefined,
      7,
    ])
      expect(isHexColour(bad), String(bad)).toBe(false);
  });

  it('parses and writes the same colour back', () => {
    expect(parseHex('#1a73e8')).toEqual([26, 115, 232]);
    expect(toHex([26, 115, 232])).toBe('#1a73e8');
    expect(parseHex('nope')).toBeNull();
    expect(toHex([300, -4, 0.4])).toBe('#ff0000');
  });
});

describe('contrast', () => {
  it('knows the extremes', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#3214db', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#3214db'), 6);
  });

  it('picks near-white on dark fills and deep slate on light fills', () => {
    expect(readableOn('#3214db')).toBe('#ffffff');
    expect(readableOn('#0b1220')).toBe('#ffffff');
    expect(readableOn('#ffd54f')).toBe('#0b1220');
    expect(readableOn('#ffffff')).toBe('#0b1220');
  });

  it('always reaches 4.5:1 on any fill with the text colour it picks', () => {
    // The worst case for a black or white choice is a mid grey; every fill on a coarse grid must still read.
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 51)
        for (let b = 0; b <= 255; b += 51) {
          const fill = toHex([r, g, b]);
          expect(contrastRatio(readableOn(fill), fill), fill).toBeGreaterThanOrEqual(4.5);
        }
  });
});

describe('ensureContrast', () => {
  it('leaves a colour that already reads alone', () => {
    expect(ensureContrast('#3214db', '#ffffff')).toBe('#3214db');
  });

  it('darkens a pale colour on a light page, keeping its hue', () => {
    const out = ensureContrast('#ffd54f', '#ffffff');
    expect(contrastRatio(out, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(out).not.toBe('#ffd54f');
    const [r, g, b] = parseHex(out)!;
    expect(r).toBeGreaterThan(b); // still a yellow, not a grey
    expect(g).toBeGreaterThan(b);
  });

  it('lightens a dark colour on a dark page', () => {
    const out = ensureContrast('#1b0d95', '#0b1220');
    expect(contrastRatio(out, '#0b1220')).toBeGreaterThanOrEqual(4.5);
  });

  it('returns what it was given when either side is not a hex', () => {
    expect(ensureContrast('red', '#ffffff')).toBe('red');
    expect(ensureContrast('#ffffff', 'nope')).toBe('#ffffff');
  });

  it('falls back to black or white at the end of the scale', () => {
    expect(ensureContrast('#fefefe', '#ffffff', 21)).toBe('#000000');
  });
});

describe('mix and check', () => {
  it('mixes toward the second colour', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', 7)).toBe('#ffffff');
  });

  it('reports a pair with its ratio and whether it passes', () => {
    expect(check('button', '#000000', '#ffffff', 4.5)).toEqual({
      pair: 'button',
      ratio: 21,
      min: 4.5,
      ok: true,
    });
    expect(check('buttonEdge', '#ffffff', '#fafafa', 3).ok).toBe(false);
  });
});
