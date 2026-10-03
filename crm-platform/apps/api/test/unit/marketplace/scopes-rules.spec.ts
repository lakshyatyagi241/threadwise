import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARKET_SCOPES,
  compareMarketVersions,
  highestScopeRisk,
  missingPermissionKeys,
  needsReconsent,
  newScopes,
  permissionKeysForScopes,
  scopeCovers,
} from '@crm/contracts';
import {
  consentMatches,
  consentProblems,
  decodeKeyset,
  decideUpgrade,
  encodeKeyset,
  likePattern,
  lockOf,
  parseAppRef,
  requestNameKey,
  versionAllows,
} from '../../../src/modules/marketplace/marketplace-rules';

const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
const seededKeys = (() => {
  const text = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))
    .join('\n');
  return new Set([...text.matchAll(/'([a-z_]+\.[a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]!));
})();

describe('scope registry', () => {
  it('every permission key a scope stands for is a real, seeded workspace permission', () => {
    for (const s of MARKET_SCOPES) {
      expect(s.permissions.length, s.id).toBeGreaterThan(0);
      for (const k of s.permissions) expect(seededKeys.has(k), `${s.id} -> ${k}`).toBe(true);
    }
  });

  it('scope ids are unique and lowercase dotted', () => {
    const ids = MARKET_SCOPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[a-z]+$/);
  });

  it('maps scopes to permission keys, once each, and unknown scopes to nothing', () => {
    expect(permissionKeysForScopes(['contacts.write', 'leads.write'])).toEqual([
      'record.contacts.create',
      'record.contacts.update',
    ]);
    expect(permissionKeysForScopes(['made.up'])).toEqual([]);
  });

  it('an app actor covers a permission only through a granted scope', () => {
    expect(scopeCovers(['contacts.read'], 'record.contacts.read')).toBe(true);
    expect(scopeCovers(['contacts.read'], 'record.contacts.update')).toBe(false);
    expect(scopeCovers([], 'record.contacts.read')).toBe(false);
    expect(scopeCovers(['leads.write'], 'record.contacts.create')).toBe(true);
  });

  it('the installer must hold every permission the scopes stand for', () => {
    const held = new Set(['record.contacts.create']);
    expect(missingPermissionKeys(['leads.write'], (k) => held.has(k))).toEqual([
      'record.contacts.update',
    ]);
    held.add('record.contacts.update');
    expect(missingPermissionKeys(['leads.write'], (k) => held.has(k))).toEqual([]);
  });

  it('the risk of a set is its highest', () => {
    expect(highestScopeRisk([])).toBe('low');
    expect(highestScopeRisk(['contacts.read', 'contacts.write'])).toBe('medium');
    expect(highestScopeRisk(['contacts.read', 'messages.send'])).toBe('high');
  });
});

describe('consent and re-consent', () => {
  it('a version that asks for a scope that was not granted needs a new consent; asking for fewer or the same never does', () => {
    expect(needsReconsent(['contacts.read'], ['contacts.read', 'deals.read'])).toBe(true);
    expect(needsReconsent(['contacts.read', 'deals.read'], ['contacts.read'])).toBe(false);
    expect(needsReconsent(['contacts.read'], ['contacts.read'])).toBe(false);
    expect(needsReconsent([], [])).toBe(false);
    expect(newScopes(['a.b'], ['a.b', 'c.d', 'c.d'])).toEqual(['c.d']);
  });

  it('the confirmed list must equal the requested list: not fewer, not more', () => {
    expect(consentMatches(['contacts.read', 'deals.read'], ['deals.read', 'contacts.read'])).toBe(
      true,
    );
    expect(consentMatches(['contacts.read', 'deals.read'], ['contacts.read'])).toBe(false);
    expect(consentMatches(['contacts.read'], ['contacts.read', 'messages.send'])).toBe(false);
    expect(consentMatches([], [])).toBe(true);
    expect(consentProblems(['a.b', 'c.d'], ['c.d', 'e.f'])).toEqual({
      missing: ['a.b'],
      extra: ['e.f'],
    });
  });

  it('publishing decides per installation: a covered version moves it with the narrower grant, an uncovered one waits for consent', () => {
    expect(decideUpgrade(['contacts.read', 'deals.read'], ['contacts.read'])).toEqual({
      kind: 'upgrade',
      granted: ['contacts.read'],
    });
    expect(decideUpgrade(['contacts.read'], ['contacts.read', 'messages.send'])).toEqual({
      kind: 'consent',
      added: ['messages.send'],
    });
  });
});

describe('listing rules', () => {
  it('versions compare numerically and a pre-release sorts before its release', () => {
    expect(compareMarketVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareMarketVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareMarketVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0);
    expect(compareMarketVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
  });

  it('a version moves draft -> in review -> approved -> published, and edits only touch a draft or a rejected one', () => {
    expect(versionAllows('draft', 'edit')).toBe(true);
    expect(versionAllows('rejected', 'edit')).toBe(true);
    expect(versionAllows('approved', 'edit')).toBe(false);
    expect(versionAllows('published', 'edit')).toBe(false);
    expect(versionAllows('approved', 'publish')).toBe(true);
    expect(versionAllows('draft', 'publish')).toBe(false);
    expect(versionAllows('in_review', 'approve')).toBe(true);
    expect(versionAllows('published', 'reject')).toBe(false);
  });

  it('what locks an app: the module, the plan, the cap; an installed app is never locked', () => {
    const base = {
      planFeature: null,
      planFeatureOn: true,
      moduleSlug: null,
      moduleOn: true,
      installed: false,
      installedCount: 0,
      cap: 0,
    };
    expect(lockOf(base, '/up')).toBeNull();
    expect(lockOf({ ...base, planFeature: 'analytics', planFeatureOn: false }, '/up')).toEqual({
      reason: 'plan_feature',
      key: 'analytics',
      upgradeUrl: '/up',
    });
    expect(lockOf({ ...base, moduleSlug: 'quotes', moduleOn: false }, '/up')).toEqual({
      reason: 'module_disabled',
      key: 'quotes',
      upgradeUrl: null,
    });
    expect(lockOf({ ...base, cap: 2, installedCount: 2 }, '/up')?.reason).toBe('limit_reached');
    expect(lockOf({ ...base, cap: 2, installedCount: 1 }, '/up')).toBeNull();
    expect(
      lockOf(
        {
          ...base,
          installed: true,
          cap: 1,
          installedCount: 5,
          planFeature: 'x',
          planFeatureOn: false,
        },
        '/up',
      ),
    ).toBeNull();
  });

  it('a request name ignores case, spaces and punctuation', () => {
    expect(requestNameKey('Just Dial')).toBe(requestNameKey('justdial!'));
    expect(requestNameKey('  99 Acres ')).toBe('99acres');
    expect(requestNameKey('Zoho Books')).not.toBe(requestNameKey('Zoho'));
    expect(requestNameKey('--')).toBe('');
  });

  it('an app reference is a uuid or a slug and nothing else', () => {
    expect(parseAppRef('webhook')).toEqual({ by: 'slug', value: 'webhook' });
    expect(parseAppRef('0F8FAD5B-D9CB-469F-A165-70867728950E')).toEqual({
      by: 'uuid',
      value: '0f8fad5b-d9cb-469f-a165-70867728950e',
    });
    for (const bad of ['', 'Webhook', "web'; drop table x;--", '../x', '1abc'])
      expect(parseAppRef(bad), bad).toBeNull();
  });

  it('keyset cursors round-trip and refuse anything that is not their own shape', () => {
    const c = encodeKeyset(['0', '100', 'a'], 42);
    expect(decodeKeyset(c, 3)).toEqual({ keys: ['0', '100', 'a'], id: 42 });
    expect(decodeKeyset(c, 2)).toBeNull();
    expect(decodeKeyset('not-base64-json', 1)).toBeNull();
    expect(
      decodeKeyset(Buffer.from(JSON.stringify({ k: [1], i: 1 })).toString('base64url'), 1),
    ).toBeNull();
  });

  it('a search box is literal', () => {
    expect(likePattern('100%_\\')).toBe('%100\\%\\_\\\\%');
  });
});
