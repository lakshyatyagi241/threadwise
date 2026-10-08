import { describe, expect, it } from 'vitest';
import { brandCss } from './brand-css';

describe('brandCss (WD-ASHELL-025)', () => {
  it('is empty without a brand or without colours', () => {
    expect(brandCss(null)).toBe('');
    expect(brandCss({ primary: null, accent: null, background: null })).toBe('');
  });

  it('sets the primary tokens, with readable text on it', () => {
    const css = brandCss({ primary: '#5B3D8A', accent: null, background: null });
    expect(css).toContain('--primary:#5B3D8A');
    expect(css).toContain('--primary-foreground:#ffffff');
    expect(brandCss({ primary: '#f5f5a0', accent: null, background: null })).toContain(
      '--primary-foreground:#0b1f1c',
    );
  });

  it('applies the background to the light theme only', () => {
    const css = brandCss({ primary: null, accent: '#00aa88', background: '#fbfaf6' });
    expect(css).toContain('--nav-accent:#00aa88');
    expect(css).toContain(":root:not([data-theme='dark']){--background:#fbfaf6}");
  });

  it('never writes anything that is not #RRGGBB', () => {
    const css = brandCss({
      primary: 'red;}body{display:none' as string,
      accent: 'url(x)' as string,
      background: '#12345' as string,
    });
    expect(css).toBe('');
  });
});
