import { describe, expect, it } from 'vitest';
import {
  buildChain,
  cacheKey,
  missingCredentials,
  providerAllowed,
  type ProviderRow,
  type RoutePolicy,
} from '../../../src/modules/localization-translation/translation-policy';

let rank = 0;
const row = (slug: string, over: Partial<ProviderRow> = {}): ProviderRow => ({
  slug,
  isActive: true,
  isDefault: false,
  sortOrder: 0,
  rank: ++rank,
  credentials: {},
  ...over,
});
const open: RoutePolicy = { lockdown: false, residency: 'any' };
const slugs = (rows: ProviderRow[], policy: RoutePolicy) => buildChain(rows, policy).map((e) => e.slug);

/** WD-I18N-019 */
describe('buildChain', () => {
  it('orders default first, then sort order, then rank', () => {
    const rows = [
      row('mymemory', { isDefault: true, sortOrder: 1 }),
      row('google_gtx', { sortOrder: 2 }),
      row('deepl', { sortOrder: 0, credentials: { api_key: 'k' } }),
    ];
    expect(slugs(rows, open)).toEqual(['mymemory', 'deepl', 'google_gtx']);
  });

  it('leaves out inactive rows and slugs no driver implements', () => {
    const rows = [row('mymemory', { isActive: false }), row('babelfish'), row('google_gtx')];
    expect(slugs(rows, open)).toEqual(['google_gtx']);
  });

  it('respects a deliberate deactivation of MyMemory (WaDesk used it anyway)', () => {
    expect(slugs([row('mymemory', { isActive: false })], open)).toEqual([]);
  });

  it('keeps the MyMemory last resort only for an install that has no MyMemory row at all', () => {
    expect(slugs([], open)).toEqual(['mymemory']);
    expect(slugs([row('google_gtx')], open)).toEqual(['google_gtx', 'mymemory']);
  });
});

/** WD-I18N-018 */
describe('lockdown', () => {
  const rows = [
    row('mymemory', { isDefault: true }),
    row('google_gtx'),
    row('libretranslate', { credentials: { endpoint: 'http://lt' } }),
    row('deepl', { credentials: { api_key: 'k' } }),
    row('google_cloud', { credentials: { api_key: 'k' } }),
  ];

  it('keeps only the official providers and adds no free last resort', () => {
    expect(slugs(rows, { lockdown: true, residency: 'any' })).toEqual(['deepl', 'google_cloud']);
    expect(slugs([], { lockdown: true, residency: 'any' })).toEqual([]);
  });

  it('lets the free providers back in when it is off', () => {
    expect(slugs(rows, open)).toHaveLength(5);
  });
});

/** WD-I18N-020 */
describe('data residency', () => {
  const rows = [
    row('mymemory'),
    row('google_gtx'),
    row('libretranslate', { credentials: { endpoint: 'http://lt' } }),
    row('deepl', { credentials: { api_key: 'k' } }),
    row('google_cloud', { credentials: { api_key: 'k' } }),
  ];

  it('eu_only allows DeepL and LibreTranslate', () => {
    expect(slugs(rows, { lockdown: false, residency: 'eu_only' }).sort()).toEqual(['deepl', 'libretranslate']);
  });

  it('local allows LibreTranslate only', () => {
    expect(slugs(rows, { lockdown: false, residency: 'local' })).toEqual(['libretranslate']);
  });

  it('never falls back to the public MyMemory endpoint under a restriction', () => {
    expect(slugs([], { lockdown: false, residency: 'eu_only' })).toEqual([]);
    expect(slugs([], { lockdown: false, residency: 'local' })).toEqual([]);
  });

  it('combines with the lockdown (the intersection)', () => {
    expect(slugs(rows, { lockdown: true, residency: 'eu_only' })).toEqual(['deepl']);
    expect(slugs(rows, { lockdown: true, residency: 'local' })).toEqual([]);
  });

  it('providerAllowed mirrors the chain', () => {
    expect(providerAllowed('google_cloud', { lockdown: false, residency: 'eu_only' })).toBe(false);
    expect(providerAllowed('deepl', { lockdown: false, residency: 'eu_only' })).toBe(true);
  });
});

/** WD-I18N-016 */
describe('missingCredentials', () => {
  it('names required keys that are absent or blank', () => {
    expect(missingCredentials('deepl', {})).toEqual(['api_key']);
    expect(missingCredentials('deepl', { api_key: '  ' })).toEqual(['api_key']);
    expect(missingCredentials('deepl', { api_key: 'x' })).toEqual([]);
    expect(missingCredentials('libretranslate', { api_key: 'x' })).toEqual(['endpoint']);
    expect(missingCredentials('mymemory', {})).toEqual([]);
    expect(missingCredentials('unknown', {})).toEqual([]);
  });
});

describe('cacheKey', () => {
  it('is stable per text and differs by direction, kind and policy', () => {
    const a = cacheKey('pair', 'en:es', 'hello', open);
    expect(a).toBe(cacheKey('pair', 'en:es', 'hello', open));
    expect(a).not.toBe(cacheKey('pair', 'en:fr', 'hello', open));
    expect(a).not.toBe(cacheKey('auto', 'en:es', 'hello', open));
    expect(a).not.toBe(cacheKey('pair', 'en:es', 'hello', { lockdown: true, residency: 'any' }));
    expect(a).not.toBe(cacheKey('pair', 'en:es', 'hello', { lockdown: false, residency: 'eu_only' }));
  });
});
