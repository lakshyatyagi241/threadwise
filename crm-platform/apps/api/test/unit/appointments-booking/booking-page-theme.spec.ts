import { describe, expect, it } from 'vitest';
import {
  BOOKING_PAGE_LIMITS,
  DEFAULT_BOOKING_THEME,
  bookingPageAssetPath,
  isBookingPageAssetPath,
  publicBookingPageSchema,
  publicManageViewSchema,
  updateBookingPageThemeSchema,
  updateBookingTypePageThemeSchema,
} from '@crm/contracts';
import {
  EMPTY_BRAND,
  EMPTY_LAYER,
  brandColor,
  layerOf,
  resolveTheme,
  themeDelta,
  type BrandKit,
  type ThemeLayer,
} from '../../../src/modules/appointments-booking/booking-page-theme.rules';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const brand: BrandKit = {
  primary: '#111111',
  accent: '#222222',
  background: '#333333',
  logo: { id: 'brand-logo', v: 'aaaaaaaa11111111' },
};
const layer = (patch: Partial<ThemeLayer> = {}): ThemeLayer => ({ ...EMPTY_LAYER, ...patch });

describe('resolveTheme: who wins', () => {
  it('a workspace with nothing saved and no brand kit gets the product look', () => {
    expect(resolveTheme({ brand: EMPTY_BRAND, canRemovePoweredBy: true })).toEqual(
      DEFAULT_BOOKING_THEME,
    );
  });

  it('the brand kit fills the colours and the logo while the workspace says to use it', () => {
    const t = resolveTheme({ workspace: layer(), brand, canRemovePoweredBy: true });
    expect(t).toMatchObject({
      primaryColor: '#111111',
      accentColor: '#222222',
      backgroundColor: '#333333',
      logo: brand.logo,
    });
  });

  it('the workspace theme beats the brand kit, field by field', () => {
    const t = resolveTheme({
      workspace: layer({ primaryColor: '#abcdef', logo: { id: ID, v: 'bbbbbbbb22222222' } }),
      brand,
      canRemovePoweredBy: true,
    });
    expect(t.primaryColor).toBe('#abcdef');
    expect(t.accentColor).toBe('#222222');
    expect(t.logo).toEqual({ id: ID, v: 'bbbbbbbb22222222' });
  });

  it('turning the brand kit off ignores it entirely', () => {
    const t = resolveTheme({
      workspace: layer({ useWorkspaceBrand: false }),
      brand,
      canRemovePoweredBy: true,
    });
    expect(t).toEqual(DEFAULT_BOOKING_THEME);
  });

  it('a service beats the workspace for what it sets and inherits the rest', () => {
    const t = resolveTheme({
      type: layer({ welcomeText: 'Service words', primaryColor: '#ff0000' }),
      workspace: layer({ welcomeText: 'Workspace words', buttonLabel: 'Book', font: 'serif' }),
      brand,
      canRemovePoweredBy: true,
    });
    expect(t).toMatchObject({
      welcomeText: 'Service words',
      primaryColor: '#ff0000',
      buttonLabel: 'Book',
      font: 'serif',
      accentColor: '#222222',
    });
  });

  it('a service picture beats the workspace picture, which beats the brand logo', () => {
    const ws = layer({ logo: { id: ID, v: 'cccccccc33333333' } });
    const own = { id: '11111111-2222-4333-8444-555555555555', v: 'dddddddd44444444' };
    expect(
      resolveTheme({ type: layer({ logo: own }), workspace: ws, brand, canRemovePoweredBy: true })
        .logo,
    ).toEqual(own);
    expect(
      resolveTheme({ type: layer(), workspace: ws, brand, canRemovePoweredBy: true }).logo,
    ).toEqual(ws.logo);
    expect(
      resolveTheme({ type: layer(), workspace: layer(), brand, canRemovePoweredBy: true }).logo,
    ).toEqual(brand.logo);
  });
});

describe('resolveTheme: the two guards', () => {
  it('a cover background without a cover is solid', () => {
    const t = resolveTheme({
      workspace: layer({ backgroundStyle: 'image' }),
      brand: EMPTY_BRAND,
      canRemovePoweredBy: true,
    });
    expect(t.backgroundStyle).toBe('solid');
    const withCover = resolveTheme({
      workspace: layer({ backgroundStyle: 'image', cover: { id: ID, v: 'eeeeeeee55555555' } }),
      brand: EMPTY_BRAND,
      canRemovePoweredBy: true,
    });
    expect(withCover.backgroundStyle).toBe('image');
  });

  it('a service can choose the cover style when the workspace has the cover', () => {
    const t = resolveTheme({
      type: layer({ backgroundStyle: 'image' }),
      workspace: layer({ cover: { id: ID, v: 'eeeeeeee55555555' } }),
      brand: EMPTY_BRAND,
      canRemovePoweredBy: true,
    });
    expect(t.backgroundStyle).toBe('image');
  });

  it('"Powered by" stays on without white-label branding, whatever was saved before', () => {
    const saved = layer({ showPoweredBy: false });
    expect(
      resolveTheme({ workspace: saved, brand: EMPTY_BRAND, canRemovePoweredBy: false })
        .showPoweredBy,
    ).toBe(true);
    expect(
      resolveTheme({ workspace: saved, brand: EMPTY_BRAND, canRemovePoweredBy: true })
        .showPoweredBy,
    ).toBe(false);
    expect(
      resolveTheme({ workspace: layer(), brand: EMPTY_BRAND, canRemovePoweredBy: true })
        .showPoweredBy,
    ).toBe(true);
  });

  it('a stored false is kept (a null is what inherits)', () => {
    const t = resolveTheme({
      workspace: layer({ showLanguageSwitch: false }),
      type: layer({ showLanguageSwitch: null }),
      brand: EMPTY_BRAND,
      canRemovePoweredBy: true,
    });
    expect(t.showLanguageSwitch).toBe(false);
  });
});

describe('brandColor', () => {
  it('keeps only a clean hex, lower-cased', () => {
    expect(brandColor('#ABCDEF')).toBe('#abcdef');
    for (const bad of ['red', '#abc', '#abcdefg', 'url(x)', null, undefined, 12, {}, '#abcdef;x'])
      expect(brandColor(bad)).toBeNull();
  });
});

describe('layerOf and themeDelta', () => {
  it('builds a layer from a stored row and its pictures', () => {
    const l = layerOf(
      { ...EMPTY_LAYER, primaryColor: '#010101', font: 'serif', useWorkspaceBrand: false },
      { logo: null, cover: { id: ID, v: 'ffffffff66666666' } },
    );
    expect(l).toMatchObject({ primaryColor: '#010101', font: 'serif', useWorkspaceBrand: false });
    expect(l.cover).toEqual({ id: ID, v: 'ffffffff66666666' });
  });

  it('lists only the fields that changed, and clips long text', () => {
    const d = themeDelta(
      { primaryColor: '#111111', welcomeText: 'a' },
      {
        primaryColor: '#222222',
        welcomeText: 'a',
        pageTitle: 'x'.repeat(200),
      },
    );
    expect(Object.keys(d).sort()).toEqual(['pageTitle', 'primaryColor']);
    expect(d.primaryColor).toEqual({ old: '#111111', new: '#222222' });
    expect(String(d.pageTitle!.new)).toHaveLength(83);
  });

  it('treats a first save as everything that is set', () => {
    expect(Object.keys(themeDelta(null, { primaryColor: '#111111', font: null }))).toEqual([
      'primaryColor',
    ]);
  });
});

describe('the contracts', () => {
  const body = {
    primaryColor: '#ABCDEF',
    accentColor: null,
    backgroundColor: undefined,
    welcomeText: '   ',
    rowVersion: null,
  };

  it('normalises a save: lower-case hex, blank text is null, missing is null', () => {
    const out = updateBookingPageThemeSchema.parse(body);
    expect(out).toMatchObject({
      primaryColor: '#abcdef',
      accentColor: null,
      backgroundColor: null,
      welcomeText: null,
      useWorkspaceBrand: true,
      font: null,
    });
  });

  it('refuses what could carry markup or a style rule', () => {
    for (const patch of [
      { primaryColor: 'javascript:alert(1)' },
      { primaryColor: '#abcdef; position:fixed' },
      { accentColor: 'var(--x)' },
      { font: 'inherit; background:url(x)' },
      { cornerStyle: '50%' },
      { backgroundStyle: 'url' },
      { welcomeText: 'x'.repeat(BOOKING_PAGE_LIMITS.welcomeText + 1) },
    ])
      expect(
        updateBookingPageThemeSchema.safeParse({ ...body, ...patch }).success,
        JSON.stringify(patch),
      ).toBe(false);
  });

  it('a service override has no font, corners, mode or footer to set', () => {
    const out = updateBookingTypePageThemeSchema.parse({
      ...body,
      font: 'serif',
      showPoweredBy: false,
    });
    expect(Object.keys(out).sort()).toEqual([
      'accentColor',
      'backgroundStyle',
      'buttonLabel',
      'primaryColor',
      'rowVersion',
      'welcomeText',
    ]);
  });

  it('an older server (no theme in the answer) still parses, with the product look', () => {
    const page = publicBookingPageSchema.parse({
      organization: { name: 'A', slug: 'a' },
      services: [],
    });
    expect(page.theme).toEqual(DEFAULT_BOOKING_THEME);
    const manage = publicManageViewSchema.parse({
      status: 'confirmed',
      organization: { name: 'A' },
      bookingType: null,
      title: 'x',
      startsAt: '2030-01-01T10:00:00.000Z',
      endsAt: '2030-01-01T10:30:00.000Z',
      timezone: 'UTC',
      meetUrl: null,
      canCancel: true,
      canReschedule: true,
      cancelFee: null,
    });
    expect(manage.theme).toEqual(DEFAULT_BOOKING_THEME);
  });

  it('a picture is only ever an id and a version, and its address is built from them', () => {
    const path = bookingPageAssetPath('acme', { id: ID, v: 'abcdef0123456789' });
    expect(path).toBe(`/api/public/appointments/assets/acme/${ID}?v=abcdef0123456789`);
    expect(isBookingPageAssetPath(path)).toBe(true);
    for (const bad of [
      'https://evil.example/a.png',
      `/api/public/appointments/assets/acme/${ID}`,
      `/api/public/appointments/assets/acme/${ID}?v=zz`,
      `/api/public/appointments/assets/acme/../x?v=abcdef01`,
      `/api/v2/other/${ID}?v=abcdef01`,
      `${path}&x=1`,
    ])
      expect(isBookingPageAssetPath(bad), bad).toBe(false);
  });
});
