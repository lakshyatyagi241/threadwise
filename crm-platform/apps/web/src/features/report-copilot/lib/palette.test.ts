import { describe, expect, it } from 'vitest';
import { DARK, LIGHT, PALETTE_SIZE, RC_CSS, RC_PRINT_CSS, colorAt, foldSlices } from './palette';

describe('palette', () => {
  it('assigns the colours in a fixed order, one per entity, and never cycles', () => {
    expect(Array.from({ length: PALETTE_SIZE }, (_, i) => colorAt(i))).toEqual(
      Array.from({ length: PALETTE_SIZE }, (_, i) => `var(--rc-${i + 1})`),
    );
    expect(colorAt(8)).toBe('var(--rc-other)');
    expect(colorAt(40)).toBe('var(--rc-other)');
    expect(colorAt(-1)).toBe('var(--rc-other)');
  });

  it('has eight distinct hues in both modes', () => {
    expect(new Set(LIGHT).size).toBe(8);
    expect(new Set(DARK).size).toBe(8);
  });

  it('defines every colour variable for light, and again for the app dark theme', () => {
    for (let i = 1; i <= 8; i++) expect(RC_CSS).toContain(`--rc-${i}:`);
    expect(RC_CSS).toContain(":root[data-theme='dark'] .rc");
    expect(RC_CSS).toContain(DARK[0]);
  });

  it('forces the light colours on paper whatever the screen theme', () => {
    for (const c of LIGHT) expect(RC_PRINT_CSS).toContain(`${c} !important`);
    expect(RC_PRINT_CSS).toContain('.report-print-root');
  });
});

describe('foldSlices', () => {
  const slices = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `s${i}`, value: i + 1 }));
  it('keeps up to eight slices as they are', () => {
    expect(foldSlices(slices(8), 'Other')).toHaveLength(8);
  });
  it('folds the smallest into one Other slice past eight, keeping the total', () => {
    const out = foldSlices(slices(12), 'Other');
    expect(out).toHaveLength(8);
    expect(out.at(-1)?.label).toBe('Other');
    expect(out.reduce((n, s) => n + s.value, 0)).toBe(78);
    expect(out[0]?.label).toBe('s11');
  });
});
