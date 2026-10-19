import {
  DEFAULT_BOOKING_THEME,
  updateBookingPageThemeSchema,
  updateBookingTypePageThemeSchema,
  type BookingPageSettingsResponse,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  draftFromResponse,
  isDirty,
  pictureProblem,
  previewView,
  typeInput,
  validate,
  workspaceInput,
  type Draft,
} from './appearance-form';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function response(
  scope: 'workspace' | 'type',
  over: Partial<BookingPageSettingsResponse['theme']> = {},
  inherited: Partial<BookingPageSettingsResponse['inherited']> = {},
): BookingPageSettingsResponse {
  return {
    scope,
    workspaceSlug: 'acme',
    typeSlug: scope === 'type' ? 'intro' : null,
    theme: {
      primaryColor: null,
      accentColor: null,
      backgroundColor: null,
      backgroundStyle: null,
      pageTitle: null,
      welcomeText: null,
      buttonLabel: null,
      font: null,
      cornerStyle: null,
      colorMode: null,
      showPoweredBy: null,
      showLanguageSwitch: null,
      useWorkspaceBrand: true,
      logo: null,
      cover: null,
      rowVersion: null,
      updatedAt: null,
      ...over,
    },
    resolved: DEFAULT_BOOKING_THEME,
    inherited: { ...DEFAULT_BOOKING_THEME, ...inherited },
    brand: { primary: null, accent: null, background: null, logo: null },
    canRemovePoweredBy: true,
    limits: {
      pageTitle: 120,
      welcomeText: 600,
      buttonLabel: 40,
      logoBytes: 1048576,
      coverBytes: 3145728,
    },
  };
}

describe('draftFromResponse', () => {
  it('gives the workspace concrete values for everything', () => {
    const d = draftFromResponse(response('workspace'));
    expect(d.font).toBe('default');
    expect(d.cornerStyle).toBe('rounded');
    expect(d.colorMode).toBe('auto');
    expect(d.backgroundStyle).toBe('solid');
    expect(d.showPoweredBy).toBe(true);
    expect(d.useWorkspaceBrand).toBe(true);
    expect(d.primaryColor).toBe('');
  });

  it('leaves a service empty where it inherits', () => {
    const d = draftFromResponse(response('type'));
    expect(d.backgroundStyle).toBe('');
    expect(d.welcomeText).toBe('');
  });

  it('reads what is saved', () => {
    const d = draftFromResponse(
      response('workspace', {
        primaryColor: '#0b6e4f',
        font: 'serif',
        pageTitle: 'Acme',
        showPoweredBy: false,
      }),
    );
    expect(d).toMatchObject({
      primaryColor: '#0b6e4f',
      font: 'serif',
      pageTitle: 'Acme',
      showPoweredBy: false,
    });
  });
});

describe('validate', () => {
  const ok = draftFromResponse(response('workspace'));

  it('accepts a clean draft and empty colours', () => {
    expect(validate(ok)).toEqual({});
    expect(validate({ ...ok, primaryColor: '#1A73E8' })).toEqual({});
  });

  it('refuses a colour that is not #RRGGBB', () => {
    for (const bad of ['red', '#fff', '#12345g', 'rgb(1,2,3)', '#000000;x']) {
      expect(validate({ ...ok, accentColor: bad }).accentColor, bad).toEqual({ code: 'colour' });
    }
  });

  it('counts characters, not bytes, against the limits', () => {
    expect(validate({ ...ok, buttonLabel: 'a'.repeat(40) })).toEqual({});
    expect(validate({ ...ok, buttonLabel: 'a'.repeat(41) }).buttonLabel).toEqual({
      code: 'tooLong',
      max: 40,
    });
    expect(validate({ ...ok, welcomeText: '😀'.repeat(600) })).toEqual({});
    expect(validate({ ...ok, pageTitle: 'é'.repeat(121) }).pageTitle).toEqual({
      code: 'tooLong',
      max: 120,
    });
  });
});

describe('the bodies sent to the API', () => {
  const draft: Draft = {
    ...draftFromResponse(response('workspace')),
    primaryColor: ' #0B6E4F ',
    accentColor: '',
    welcomeText: '  Hello  ',
    buttonLabel: '',
    font: 'rounded',
    showPoweredBy: false,
  };

  it('the workspace body trims, lower-cases colours and sends blanks as null', () => {
    const body = workspaceInput(draft, 3);
    expect(body).toMatchObject({
      primaryColor: '#0b6e4f',
      accentColor: null,
      welcomeText: 'Hello',
      buttonLabel: null,
      font: 'rounded',
      showPoweredBy: false,
      rowVersion: 3,
    });
    expect(updateBookingPageThemeSchema.safeParse(body).success).toBe(true);
  });

  it('a first save carries a null row version', () => {
    expect(updateBookingPageThemeSchema.safeParse(workspaceInput(draft, null)).success).toBe(true);
  });

  it('the service body holds only what a service may override', () => {
    const body = typeInput({ ...draft, backgroundStyle: 'tint' }, 2);
    expect(Object.keys(body).sort()).toEqual([
      'accentColor',
      'backgroundStyle',
      'buttonLabel',
      'primaryColor',
      'rowVersion',
      'welcomeText',
    ]);
    expect(updateBookingTypePageThemeSchema.safeParse(body).success).toBe(true);
  });

  it('what the API would reject, the form already refuses', () => {
    const bad = { ...draft, primaryColor: 'blue' };
    expect(validate(bad).primaryColor).toBeDefined();
    // the body builder never forwards an invalid colour: it becomes "inherit"
    expect(workspaceInput(bad, 1).primaryColor).toBeNull();
  });
});

describe('isDirty', () => {
  const initial = draftFromResponse(response('workspace'));
  it('is false for the same draft and true for any edit or staged picture', () => {
    expect(isDirty(initial, { ...initial }, {})).toBe(false);
    expect(isDirty(initial, { ...initial, font: 'serif' }, {})).toBe(true);
    expect(isDirty(initial, initial, { logo: null })).toBe(true);
    expect(
      isDirty(initial, initial, { cover: new File(['x'], 'c.png', { type: 'image/png' }) }),
    ).toBe(true);
  });
});

describe('pictureProblem', () => {
  it('checks the type and the size for the slot', () => {
    expect(pictureProblem({ type: 'image/png', size: 1000 }, 'logo')).toBeNull();
    expect(pictureProblem({ type: 'image/svg+xml', size: 1000 }, 'logo')).toBe('type');
    expect(pictureProblem({ type: 'application/pdf', size: 1000 }, 'cover')).toBe('type');
    expect(pictureProblem({ type: 'image/png', size: 1024 * 1024 + 1 }, 'logo')).toBe('size');
    expect(pictureProblem({ type: 'image/jpeg', size: 1024 * 1024 + 1 }, 'cover')).toBeNull();
    expect(pictureProblem({ type: 'image/jpeg', size: 3 * 1024 * 1024 + 1 }, 'cover')).toBe('size');
  });
});

describe('previewView', () => {
  it('draws the draft over what is inherited', () => {
    const r = response('workspace', {}, { primaryColor: '#112233' });
    const d = { ...draftFromResponse(r), welcomeText: 'Hi', accentColor: '#abcdef' };
    const v = previewView(r, d, {}, {});
    expect(v.primaryColor).toBe('#112233');
    expect(v.accentColor).toBe('#abcdef');
    expect(v.welcomeText).toBe('Hi');
  });

  it('a service keeps the workspace font, corners, mode and footer, whatever its draft holds', () => {
    const r = response(
      'type',
      {},
      { font: 'serif', cornerStyle: 'pill', colorMode: 'dark', showPoweredBy: false },
    );
    const v = previewView(
      r,
      { ...draftFromResponse(r), font: 'rounded', cornerStyle: 'square' },
      {},
      {},
    );
    expect(v).toMatchObject({
      font: 'serif',
      cornerStyle: 'pill',
      colorMode: 'dark',
      showPoweredBy: false,
    });
  });

  it('forces "Powered by" on when the plan cannot remove it', () => {
    const r = { ...response('workspace'), canRemovePoweredBy: false };
    const v = previewView(r, { ...draftFromResponse(r), showPoweredBy: false }, {}, {});
    expect(v.showPoweredBy).toBe(true);
  });

  it('a cover background without a cover is a solid one', () => {
    const r = response('workspace');
    const d = { ...draftFromResponse(r), backgroundStyle: 'image' as const };
    expect(previewView(r, d, {}, {}).backgroundStyle).toBe('solid');
    const withCover = previewView(
      r,
      d,
      { cover: new File(['x'], 'c.png') },
      { cover: 'blob:http://l/1' },
    );
    expect(withCover.backgroundStyle).toBe('image');
    expect(withCover.coverUrl).toBe('blob:http://l/1');
  });

  it('shows the staged picture, then the saved one, then the inherited one; removing falls back', () => {
    const saved = { id: ID, v: 'abcdef0123456789' };
    const r = response(
      'type',
      { logo: saved },
      { logo: { id: 'brand-logo', v: 'fedcba9876543210' } },
    );
    const d = draftFromResponse(r);
    expect(previewView(r, d, {}, {}).logoUrl).toContain(ID);
    expect(previewView(r, d, { logo: new File(['x'], 'l.png') }, { logo: 'blob:x' }).logoUrl).toBe(
      'blob:x',
    );
    expect(previewView(r, d, { logo: null }, {}).logoUrl).toContain('brand-logo');
  });
});
