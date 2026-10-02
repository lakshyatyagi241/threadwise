import { describe, expect, it } from 'vitest';
import { authPagesPatchSchema, type AuthPagesResponse } from '@crm/contracts';
import {
  REAL_PAGE_PATHS,
  SHOWCASE_GROUPS,
  SHOWCASE_GROUPS_BY_PAGE,
  SHOWCASE_PAGES,
  authPagesFieldForPath,
  authPagesPatchSize,
  authPagesToDraft,
  buildAuthPagesPatch,
  guessMediaType,
  isAcceptedAccent,
  isHttpsUrl,
  resolvePreviewContent,
  resolvePreviewExtra,
} from './auth-pages-draft';

const shipped = (accent = '#0f766e') => ({
  eyebrow: 'Shipped eyebrow',
  heading: 'Shipped heading',
  headingAccent: 'shipped accent',
  subheading: 'Shipped sub-text',
  accent,
});
const defaults = { login: shipped(), register: shipped('#112233'), forgot: shipped() };

const base: AuthPagesResponse = {
  defaults,
  variant: 1,
  login: {},
  register: {},
  forgot: {},
  extra: { login: {}, register: {}, forgot: {} },
};

describe('buildAuthPagesPatch', () => {
  it('sends nothing for an untouched editor', () => {
    expect(buildAuthPagesPatch(base, authPagesToDraft(base))).toEqual({ patch: {}, problems: {} });
  });

  it('sends the design template only when it changed', () => {
    const d = authPagesToDraft(base);
    d.variant = 3;
    expect(buildAuthPagesPatch(base, d).patch).toEqual({ variant: 3 });
  });

  it('sends changed text, trimmed, and an empty string to restore the default', () => {
    const stored: AuthPagesResponse = { ...base, login: { heading: 'Hi', eyebrow: 'Old' } };
    const d = authPagesToDraft(stored);
    d.pages.login.heading = '  Hello  ';
    d.pages.login.eyebrow = '';
    expect(buildAuthPagesPatch(stored, d).patch).toEqual({
      login: { heading: 'Hello', eyebrow: '' },
    });
  });

  it('sends a changed accent and rejects a malformed one', () => {
    const d = authPagesToDraft(base);
    d.pages.register.accent = '#AABBCC';
    expect(buildAuthPagesPatch(base, d).patch).toEqual({ register: { accent: '#aabbcc' } });
    d.pages.register.accent = 'teal';
    expect(buildAuthPagesPatch(base, d).problems).toEqual({ 'register.accent': 'accent' });
  });

  it('restores the shipped accent by sending an empty value, which clears the override', () => {
    const stored: AuthPagesResponse = { ...base, forgot: { accent: '#112233' } };
    const d = authPagesToDraft(stored);
    d.pages.forgot.accent = '';
    expect(buildAuthPagesPatch(stored, d).patch).toEqual({ forgot: { accent: '' } });
  });

  it('sends nothing when the accent was never overridden and stays empty', () => {
    const d = authPagesToDraft(base);
    d.pages.forgot.accent = '';
    expect(buildAuthPagesPatch(base, d).patch).toEqual({});
  });

  it('adds media with its type, and refuses a non-https address', () => {
    const d = authPagesToDraft(base);
    d.pages.login.mediaUrl = 'https://cdn.example.com/hero.mp4';
    d.pages.login.mediaType = 'video';
    expect(buildAuthPagesPatch(base, d).patch).toEqual({
      login: { mediaUrl: 'https://cdn.example.com/hero.mp4', mediaType: 'video' },
    });
    d.pages.login.mediaUrl = 'http://cdn.example.com/hero.mp4';
    expect(buildAuthPagesPatch(base, d).problems).toEqual({ 'login.mediaUrl': 'mediaUrl' });
    d.pages.login.mediaUrl = 'javascript:alert(1)';
    expect(buildAuthPagesPatch(base, d).problems).toEqual({ 'login.mediaUrl': 'mediaUrl' });
  });

  it('clears media through clearMedia, never an empty URL', () => {
    const stored: AuthPagesResponse = {
      ...base,
      login: { mediaUrl: 'https://x.test/a.png', mediaType: 'image' },
    };
    const d = authPagesToDraft(stored);
    d.pages.login.mediaUrl = '';
    const { patch } = buildAuthPagesPatch(stored, d);
    expect(patch).toEqual({ clearMedia: ['login'] });
  });

  it('sends a type-only change for existing media', () => {
    const stored: AuthPagesResponse = {
      ...base,
      login: { mediaUrl: 'https://x.test/a.png', mediaType: 'image' },
    };
    const d = authPagesToDraft(stored);
    d.pages.login.mediaType = 'gif';
    expect(buildAuthPagesPatch(stored, d).patch).toEqual({
      login: { mediaUrl: 'https://x.test/a.png', mediaType: 'gif' },
    });
  });

  it('sends only the showcase keys that changed, and "" to clear one', () => {
    const stored: AuthPagesResponse = {
      ...base,
      extra: { login: { chip1: 'Old', hero_title: 'Keep' }, register: {}, forgot: {} },
    };
    const d = authPagesToDraft(stored);
    d.extra.login.chip1 = '';
    d.extra.login.chip2 = ' New ';
    expect(buildAuthPagesPatch(stored, d).patch).toEqual({
      extra: { login: { chip1: '', chip2: 'New' } },
    });
  });

  it('edits the forgot page footer and hero text and sends them under extra.forgot', () => {
    const stored: AuthPagesResponse = {
      ...base,
      extra: { login: {}, register: {}, forgot: { footer: 'Old footer' } },
    };
    const d = authPagesToDraft(stored);
    expect(d.extra.forgot.footer).toBe('Old footer');
    d.extra.forgot.footer = ' New footer ';
    d.extra.forgot.hero_title = 'Hello';
    const { patch } = buildAuthPagesPatch(stored, d);
    expect(patch).toEqual({ extra: { forgot: { footer: 'New footer', hero_title: 'Hello' } } });
    expect(authPagesPatchSchema.safeParse(patch).success).toBe(true);
    expect(authPagesPatchSize(patch)).toBe(2);
  });

  it('starts the forgot extras empty when an older server does not send them', () => {
    const noForgot: AuthPagesResponse = { ...base, extra: { login: {}, register: {} } };
    expect(authPagesToDraft(noForgot).extra.forgot).toEqual({});
    expect(buildAuthPagesPatch(noForgot, authPagesToDraft(noForgot))).toEqual({
      patch: {},
      problems: {},
    });
  });

  it('produces a body the API contract accepts', () => {
    const d = authPagesToDraft(base);
    d.variant = 5;
    d.pages.login.heading = 'x';
    d.pages.login.accent = '#123456';
    d.pages.login.mediaUrl = 'https://x.test/p.png';
    d.extra.register.footer = 'Footer';
    expect(authPagesPatchSchema.safeParse(buildAuthPagesPatch(base, d).patch).success).toBe(true);
  });
});

describe('authPagesPatchSize', () => {
  it('counts every changed setting', () => {
    expect(
      authPagesPatchSize({
        variant: 2,
        login: { heading: 'a', accent: '#111111' },
        clearMedia: ['forgot'],
        extra: { register: { chip1: 'x' } },
      }),
    ).toBe(5);
    expect(authPagesPatchSize({})).toBe(0);
  });
});

describe('resolvePreviewContent', () => {
  it('falls back to the shipped copy for emptied fields', () => {
    const d = authPagesToDraft(base).pages.login;
    d.heading = '   ';
    d.eyebrow = 'Custom';
    const c = resolvePreviewContent('login', d, defaults);
    expect(c.heading).toBe('Shipped heading');
    expect(c.eyebrow).toBe('Custom');
    expect(c.accent).toBe('#0f766e');
    expect(c.mediaUrl).toBeUndefined();
  });
  it('shows media only for a usable https address and an accent only when it is a colour', () => {
    const d = authPagesToDraft(base).pages.register;
    d.mediaUrl = 'https://x.test/a.png';
    d.mediaType = 'gif';
    d.accent = '#ABCDEF';
    expect(resolvePreviewContent('register', d, defaults)).toMatchObject({
      mediaUrl: 'https://x.test/a.png',
      mediaType: 'gif',
      accent: '#abcdef',
    });
    d.mediaUrl = 'ftp://x.test/a.png';
    d.accent = 'nope';
    const c = resolvePreviewContent('register', d, defaults);
    expect(c.mediaUrl).toBeUndefined();
    expect(c.accent).toBe('#112233');
  });
});

describe('helpers', () => {
  it('guesses media type from the extension, ignoring the query string', () => {
    expect(guessMediaType('https://x.test/a.MP4?token=1')).toBe('video');
    expect(guessMediaType('https://x.test/a.webm')).toBe('video');
    expect(guessMediaType('https://x.test/a.gif#x')).toBe('gif');
    expect(guessMediaType('https://x.test/a.jpg')).toBe('image');
  });
  it('accepts https URLs only', () => {
    expect(isHttpsUrl('https://x.test/a.png')).toBe(true);
    expect(isHttpsUrl('http://x.test/a.png')).toBe(false);
    expect(isHttpsUrl('')).toBe(false);
    expect(isHttpsUrl(`https://x.test/${'a'.repeat(2100)}`)).toBe(false);
  });
  it('drops empty showcase values for the preview', () => {
    expect(resolvePreviewExtra({ a: ' x ', b: '  ', c: '' })).toEqual({ a: 'x' });
  });
  it('maps API error paths to a page and a control', () => {
    expect(authPagesFieldForPath('login.mediaUrl')).toEqual({
      page: 'login',
      control: 'login-mediaUrl',
    });
    expect(authPagesFieldForPath('extra.register.chip3')).toEqual({
      page: 'register',
      control: 'extra-register-chip3',
    });
    expect(authPagesFieldForPath('extra.forgot.footer')).toEqual({
      page: 'forgot',
      control: 'extra-forgot-footer',
    });
    expect(authPagesFieldForPath('variant')).toEqual({ page: null, control: 'variant' });
    expect(authPagesFieldForPath('nope')).toBeNull();
  });
  it('lists every showcase key of the contract exactly once', () => {
    const keys = Object.values(SHOWCASE_GROUPS).flat();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(24);
  });
});

describe('isAcceptedAccent', () => {
  it('accepts what the contract accepts: six-digit hex in either case, or empty to reset', () => {
    expect(isAcceptedAccent('#0f766e')).toBe(true);
    expect(isAcceptedAccent('#0F766E')).toBe(true);
    expect(isAcceptedAccent('')).toBe(true);
  });
  it('refuses short, long, named and unprefixed colours, as the contract does', () => {
    for (const v of ['#fff', '#0f766eaa', 'teal', '0f766e', 'rgb(1,2,3)', '#12345g'])
      expect(isAcceptedAccent(v)).toBe(false);
  });
});

describe('showcase fields per page', () => {
  it('offers the hero card and footer on the forgot page and everything on the others', () => {
    expect(SHOWCASE_PAGES).toEqual(['login', 'register', 'forgot']);
    expect(SHOWCASE_GROUPS_BY_PAGE.forgot).toEqual(['hero', 'footer']);
    expect(SHOWCASE_GROUPS_BY_PAGE.login).toEqual(['hero', 'stats', 'features', 'chips', 'footer']);
    expect(SHOWCASE_GROUPS_BY_PAGE.register).toEqual(SHOWCASE_GROUPS_BY_PAGE.login);
  });
  it('only names groups the editor has fields for', () => {
    for (const groups of Object.values(SHOWCASE_GROUPS_BY_PAGE))
      for (const g of groups) expect(Object.keys(SHOWCASE_GROUPS)).toContain(g);
  });
});

describe('REAL_PAGE_PATHS', () => {
  it('points at the pages visitors use', () => {
    expect(REAL_PAGE_PATHS).toEqual({
      login: '/login',
      register: '/signup',
      forgot: '/forgot-password',
    });
  });
});
