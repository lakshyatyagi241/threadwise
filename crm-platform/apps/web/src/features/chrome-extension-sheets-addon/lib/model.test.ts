import { describe, expect, it } from 'vitest';
import { ERROR_CODES, EXT_SHEETS_FILE_NAMES, type ExtSheetsOverview } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  afterRevoke,
  capabilityList,
  displayMask,
  errorKind,
  formatPrice,
  formatWhen,
  orderedFiles,
  shopTitle,
  sizeLabel,
  viewState,
} from './model';

const overview = (over: Partial<ExtSheetsOverview> = {}): ExtSheetsOverview => ({
  installed: true,
  blockers: [],
  marketplaceUrl: null,
  apiBase: 'https://api.example.com',
  webhookUrl: null,
  lastCapture: null,
  key: { active: false, suffix: null, masked: null, createdAt: null, lastUsedAt: null },
  can: { readContacts: true, writeContacts: true, readCatalog: true, writeCatalog: false },
  files: [],
  shops: [],
  productCount: 0,
  recentProducts: [],
  ...over,
});

describe('viewState', () => {
  const base = { canUse: true, isPending: false, isError: false, overview: overview() };
  it('checks the permission before anything is loaded', () => {
    expect(viewState({ ...base, canUse: false, isPending: true })).toBe('noPermission');
  });
  it('is loading, then error, then not installed, then ready', () => {
    expect(viewState({ ...base, isPending: true, overview: undefined })).toBe('loading');
    expect(viewState({ ...base, isError: true, overview: undefined })).toBe('error');
    expect(viewState({ ...base, overview: undefined })).toBe('error');
    expect(
      viewState({ ...base, overview: overview({ installed: false, blockers: ['not_installed'] }) }),
    ).toBe('notInstalled');
    expect(viewState({ ...base, overview: overview({ blockers: ['not_installed'] }) })).toBe(
      'notInstalled',
    );
    expect(viewState(base)).toBe('ready');
  });
});

describe('errorKind', () => {
  const err = (status: number, code: string) => new ApiError(status, code, 'x');
  it('branches on the stable code, then the status', () => {
    expect(errorKind(err(403, ERROR_CODES.EXT_APP_NOT_INSTALLED))).toBe('notInstalled');
    expect(errorKind(err(422, ERROR_CODES.PLAN_FEATURE_LOCKED))).toBe('planLocked');
    expect(errorKind(err(403, ERROR_CODES.WSP_ORG_SUSPENDED))).toBe('suspended');
    expect(errorKind(err(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
    expect(errorKind(err(403, 'SOMETHING'))).toBe('forbidden');
    expect(errorKind(err(429, ERROR_CODES.RATE_LIMITED))).toBe('rateLimited');
    expect(errorKind(err(500, 'INTERNAL'))).toBe('unexpected');
    expect(errorKind(new TypeError('failed to fetch'))).toBe('network');
  });
});

describe('displayMask', () => {
  it('prints the server mask, builds one from the suffix, and nothing without a key', () => {
    const none = { active: false, suffix: null, masked: null, createdAt: null, lastUsedAt: null };
    expect(displayMask(none)).toBeNull();
    expect(
      displayMask({
        ...none,
        active: true,
        suffix: '89abcdef',
        masked: 'wsn_live_••••••••89abcdef',
      }),
    ).toBe('wsn_live_••••••••89abcdef');
    expect(displayMask({ ...none, active: true, suffix: '89abcdef' })).toBe(
      'wsn_live_••••••••89abcdef',
    );
    expect(displayMask({ ...none, active: true })).toBeNull();
  });
  it('never contains more of the key than its last 8 characters', () => {
    const secret = 'wsn_live_0123456789abcdef0123456789abcdef';
    const mask = displayMask({
      active: true,
      suffix: secret.slice(-8),
      masked: null,
      createdAt: null,
      lastUsedAt: null,
    })!;
    expect(mask).not.toContain(secret.slice(9, 25));
    expect(mask.endsWith(secret.slice(-8))).toBe(true);
  });
});

describe('capabilityList', () => {
  it('lists the four capabilities in a fixed order with the role flag', () => {
    expect(capabilityList(overview().can)).toEqual([
      { id: 'readContacts', allowed: true },
      { id: 'writeContacts', allowed: true },
      { id: 'readCatalog', allowed: true },
      { id: 'writeCatalog', allowed: false },
    ]);
  });
});

describe('orderedFiles', () => {
  it('always returns the six files in order, marking the ones the server did not list as unavailable', () => {
    const files = orderedFiles([
      {
        name: 'README.md',
        description: 'd',
        available: true,
        sizeBytes: 10,
        contentType: 'text/markdown',
      },
    ]);
    expect(files.map((f) => f.name)).toEqual([...EXT_SHEETS_FILE_NAMES]);
    expect(files.find((f) => f.name === 'README.md')?.available).toBe(true);
    expect(files.filter((f) => f.available)).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('sizes files', () => {
    expect(sizeLabel(0)).toBe('');
    expect(sizeLabel(512)).toBe('512 B');
    expect(sizeLabel(18211)).toBe('18 KB');
    expect(sizeLabel(1025)).toBe('1 KB');
  });
  it('formats dates and survives bad ones', () => {
    expect(formatWhen(null, 'en')).toBeNull();
    expect(formatWhen('not a date', 'en')).toBeNull();
    expect(formatWhen('2026-10-07T09:41:00.000Z', 'en')).toContain('2026');
  });
  it('reads a time in the zone it is given', () => {
    const iso = '2026-10-02T20:30:00Z';
    expect(formatWhen(iso, 'en-US', 'Asia/Kolkata')).toBe('Oct 3, 2026, 2:00 AM');
    expect(formatWhen(iso, 'en-US', 'America/New_York')).toBe('Oct 2, 2026, 4:30 PM');
  });
  it('formats prices with the currency, and falls back for an unknown code', () => {
    expect(formatPrice('499', 'USD', 'en')).toBe('$499.00');
    expect(formatPrice('499', 'ZZZZ', 'en')).toBe('ZZZZ 499');
    expect(formatPrice('abc', 'INR', 'en')).toBe('abc INR');
  });
  it('titles a shop by name, else by address', () => {
    expect(shopTitle({ shopName: ' Corner ', slug: 'c' })).toBe('Corner');
    expect(shopTitle({ shopName: null, slug: 'corner-store' })).toBe('corner-store');
  });
  it('forgets the shown secret after a revoke', () => {
    expect(afterRevoke()).toBeNull();
  });
});
