import { DEFAULT_BOOKING_THEME, type PublicBookingTheme } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColour } from '@/lib/brand-kit/colour';
import {
  FONT_STACKS,
  buildPalette,
  safeImageSrc,
  schemeFor,
  toView,
  warningsOf,
  wrapperStyle,
} from './booking-theme';

const view = (patch: Partial<PublicBookingTheme> = {}) =>
  toView({ ...DEFAULT_BOOKING_THEME, ...patch }, 'acme');

describe('schemeFor', () => {
  it('forces light and dark, and follows the device on auto', () => {
    expect(schemeFor('light', true)).toBe('light');
    expect(schemeFor('dark', false)).toBe('dark');
    expect(schemeFor('auto', true)).toBe('dark');
    expect(schemeFor('auto', false)).toBe('light');
  });
});

describe('the product look', () => {
  it('is unchanged when nothing is set: the same colours as the app tokens', () => {
    const light = buildPalette(view(), 'light').vars;
    expect(light['--background']).toBe('#ffffff');
    expect(light['--primary']).toBe('#3214db');
    expect(light['--brand']).toBe('#3214db');
    expect(light['--brand-foreground']).toBe('#ffffff');
    const dark = buildPalette(view(), 'dark').vars;
    expect(dark['--background']).toBe('#0b1220');
    expect(dark['--primary']).toBe('#8b7cf6');
    expect(dark['--brand']).toBe('#3214db');
  });

  it('sets no font family for the product font', () => {
    const style = wrapperStyle(view(), buildPalette(view(), 'light'));
    expect(style.fontFamily).toBeUndefined();
    expect(style.colorScheme).toBe('light');
  });
});

describe('a custom theme', () => {
  it('uses the button colour for buttons and the primary colour for text', () => {
    const v = view({ primaryColor: '#0b6e4f', accentColor: '#f4a300' });
    const p = buildPalette(v, 'light').vars;
    expect(p['--brand']).toBe('#f4a300');
    expect(p['--brand-foreground']).toBe('#0b1220');
    expect(p['--primary']).toBe('#0b6e4f');
  });

  it('uses the primary colour for buttons when no button colour is set', () => {
    const p = buildPalette(view({ primaryColor: '#0b6e4f' }), 'light').vars;
    expect(p['--brand']).toBe('#0b6e4f');
    expect(p['--brand-foreground']).toBe('#ffffff');
  });

  it('adjusts a primary colour that is too pale to read as text, in both modes', () => {
    const v = view({ primaryColor: '#ffe066' });
    const light = buildPalette(v, 'light').vars;
    expect(contrastRatio(light['--primary']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // the fill keeps the owner's colour; only the text use is adjusted
    expect(light['--brand']).toBe('#ffe066');
    const dark = buildPalette(v, 'dark').vars;
    expect(contrastRatio(dark['--primary']!, '#0b1220')).toBeGreaterThanOrEqual(4.5);
  });

  it('picks readable text on every fill', () => {
    for (const fill of ['#000000', '#ffffff', '#777777', '#ff00ff', '#00ffff', '#123456']) {
      const p = buildPalette(view({ accentColor: fill }), 'light').vars;
      expect(contrastRatio(p['--brand-foreground']!, p['--brand']!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps muted text readable on its own tint and on the surface', () => {
    for (const primary of ['#ff0000', '#00aa00', '#3214db', '#ffcc00']) {
      for (const scheme of ['light', 'dark'] as const) {
        const p = buildPalette(view({ primaryColor: primary }), scheme).vars;
        expect(contrastRatio(p['--muted-foreground']!, p['--muted']!)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p['--muted-foreground']!, p['--background']!)).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('keeps text on the page background readable whatever colour it is', () => {
    for (const bg of ['#000000', '#ffffff', '#ff0000', '#808080', '#f5e6ff']) {
      for (const scheme of ['light', 'dark'] as const) {
        const p = buildPalette(view({ backgroundColor: bg }), scheme).vars;
        expect(contrastRatio(p['--bk-backdrop-fg']!, p['--bk-backdrop']!)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(p['--bk-backdrop-muted']!, p['--bk-backdrop']!),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('takes a pale page colour down to a dark shade in dark mode', () => {
    const v = view({ backgroundColor: '#fff3e0' });
    expect(buildPalette(v, 'light').vars['--bk-backdrop']).toBe('#fff3e0');
    const dark = buildPalette(v, 'dark').vars['--bk-backdrop']!;
    expect(contrastRatio(dark, '#0b1220')).toBeLessThan(2);
  });

  it('washes the page with the primary colour for the soft tint', () => {
    const p = buildPalette(
      view({ backgroundStyle: 'tint', primaryColor: '#0b6e4f' }),
      'light',
    ).vars;
    expect(p['--bk-backdrop']).not.toBe('#f8f7ff');
    expect(contrastRatio(p['--bk-backdrop']!, '#ffffff')).toBeLessThan(1.3);
  });

  it('writes the corner scale', () => {
    expect(buildPalette(view({ cornerStyle: 'square' }), 'light').vars['--radius']).toBe('0px');
    expect(buildPalette(view({ cornerStyle: 'pill' }), 'light').vars['--radius']).toBe('9999px');
    expect(buildPalette(view({ cornerStyle: 'rounded' }), 'light').vars['--radius']).toBe('0.5rem');
  });

  it('only ever writes safe values into the style', () => {
    const v = view({
      primaryColor: '#0b6e4f',
      accentColor: '#f4a300',
      backgroundColor: '#fff3e0',
      font: 'serif',
      cornerStyle: 'pill',
    });
    const style = wrapperStyle(v, buildPalette(v, 'light'));
    expect(style.fontFamily).toBe(FONT_STACKS.serif);
    for (const [k, value] of Object.entries(style)) {
      if (
        /^--(background|foreground|muted|border|primary|brand|danger|success|warning|bk-)/.test(k)
      ) {
        expect(isHexColour(value), `${k}: ${value}`).toBe(true);
      } else if (k.startsWith('--radius')) {
        expect(value, k).toMatch(/^(0px|9999px|\d+(\.\d+)?rem)$/);
      }
      expect(value).not.toMatch(/[;{}<>]|url\(|expression|javascript/i);
    }
  });

  it('ignores a colour that is not a clean hex (it never reaches the style)', () => {
    const hostile = view({ primaryColor: '#000000;background:url(//evil)' });
    const p = buildPalette(hostile, 'light').vars;
    expect(p['--primary']).toBe('#3214db');
    expect(JSON.stringify(p)).not.toContain('evil');
  });
});

describe('contrast findings', () => {
  it('flags a button that blends into the page', () => {
    const findings = warningsOf(buildPalette(view({ accentColor: '#fafafa' }), 'light').checks);
    expect(findings.map((c) => c.pair)).toContain('buttonEdge');
  });

  it('flags a primary colour too pale for text, and nothing for the default look', () => {
    expect(
      warningsOf(buildPalette(view({ primaryColor: '#ffe066' }), 'light').checks).map(
        (c) => c.pair,
      ),
    ).toContain('primaryText');
    expect(warningsOf(buildPalette(view(), 'light').checks)).toEqual([]);
    expect(warningsOf(buildPalette(view(), 'dark').checks)).toEqual([]);
    expect(warningsOf(buildPalette(view(), 'dark').checks)).toEqual([]);
  });

  it('never reports button text as a problem: it is picked to read', () => {
    for (const fill of ['#808080', '#767676', '#ffffff', '#000000']) {
      const found = warningsOf(buildPalette(view({ accentColor: fill }), 'light').checks);
      expect(found.map((c) => c.pair)).not.toContain('button');
    }
  });
});

describe('pictures', () => {
  const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

  it('builds addresses from the workspace and the picture ref only', () => {
    const v = toView({ ...DEFAULT_BOOKING_THEME, logo: { id: ID, v: 'abcdef0123456789' } }, 'acme');
    expect(v.logoUrl).toBe(`/api/public/appointments/assets/acme/${ID}?v=abcdef0123456789`);
    expect(v.coverUrl).toBeNull();
  });

  it('lets only our own addresses (and, in the editor, a local file) be loaded', () => {
    const own = '/api/public/appointments/assets/acme/brand-logo?v=abcdef01';
    expect(safeImageSrc(own)).toBe(own);
    expect(safeImageSrc('https://evil.example/x.png')).toBeNull();
    expect(safeImageSrc('//evil.example/x.png')).toBeNull();
    expect(safeImageSrc('javascript:alert(1)')).toBeNull();
    expect(safeImageSrc('data:image/svg+xml;base64,AAAA')).toBeNull();
    expect(safeImageSrc('/api/public/appointments/assets/acme/../../x?v=abcdef01')).toBeNull();
    expect(safeImageSrc('blob:http://localhost/1234')).toBeNull();
    expect(safeImageSrc('blob:http://localhost/1234', true)).toBe('blob:http://localhost/1234');
    expect(safeImageSrc(null)).toBeNull();
  });

  it('shows a file just chosen instead of the saved one, and nothing after a removal', () => {
    const saved = { ...DEFAULT_BOOKING_THEME, logo: { id: ID, v: 'abcdef0123456789' } };
    expect(toView(saved, 'acme', { logo: 'blob:x' }).logoUrl).toBe('blob:x');
    expect(toView(saved, 'acme', { logo: null }).logoUrl).toBeNull();
  });
});
