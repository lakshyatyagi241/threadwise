import { describe, expect, it } from 'vitest';
import { parseManifestText, readStoredManifest, toLocalPath } from '@crm/contracts';
import { compareVersions } from '../../../src/modules/addons-extension-registry/version';

const parse = (m: unknown) => parseManifestText(JSON.stringify(m));

describe('extension manifest (TW-ADD-004)', () => {
  it('needs a slug and defaults everything else', () => {
    expect(parse({})).toBeNull(); // no slug: malformed
    expect(parse({ slug: '' })).toBeNull();
    expect(parseManifestText('not json')).toBeNull();
    expect(parseManifestText('[1,2]')).toBeNull();
    expect(parse({ slug: 'foo' })).toMatchObject({
      slug: 'foo',
      name: 'foo',
      version: '1.0.0',
      minCore: '',
      migrate: true,
      routes: [],
      planFeatures: [],
      planLimits: [],
      nav: { admin: [], user: [] },
    });
  });

  it('validates the slug against ^[a-z0-9_-]{1,64}$ so it can never steer extraction (TW-ADD-004 rule 3)', () => {
    for (const slug of ['../evil', 'a/b', 'A', 'x y', 'a'.repeat(65), '..', 'a\\b']) {
      expect(parse({ slug }), slug).toBeNull();
    }
    expect(parse({ slug: 'a'.repeat(64) })).not.toBeNull();
    expect(parse({ slug: 'my-mod_2' })).not.toBeNull();
  });

  it('tolerates a byte-order mark', () => {
    expect(parseManifestText('﻿{"slug":"x"}')?.slug).toBe('x');
  });

  it('keeps only valid nav items, forces hrefs onto this app, and never accepts raw icon markup', () => {
    const m = parse({
      slug: 'foo',
      nav: {
        admin: [
          { key: 'a', href: '/admin/a', label: 'A', icon: 'chart' },
          { key: 'no_href' },
          { href: '/x' },
          { key: 'off', href: 'https://evil.example/steal?x=1', icon: '<svg onload=alert(1)>' },
          'junk',
        ],
      },
    })!;
    expect(m.nav.admin.map((n) => n.key)).toEqual(['a', 'off']);
    expect(m.nav.admin[1]).toMatchObject({ href: '/steal?x=1', icon: null, label: 'off' });
    expect(m.nav.admin[0]).toMatchObject({ icon: 'chart', after: '' });
  });

  it('accepts plan flags and limits as a list of keys or a map, skipping empty and duplicate keys', () => {
    const list = parse({ slug: 'foo', plan_features: ['access_x', '', 'access_x', 'Bad Key'] })!;
    expect(list.planFeatures).toEqual([{ key: 'access_x', label: 'Access x', group: 'foo' }]);

    const map = parse({
      slug: 'foo',
      name: 'Foo',
      plan_features: { access_y: { label: 'Y access', group: 'Foo pack' } },
      plan_limits: {
        y_seats: { label: 'Seats', default: 5, hint: 'per workspace' },
        y_unlimited: { default: null },
        y_zero: { default: 0 },
      },
    })!;
    expect(map.planFeatures[0]).toEqual({ key: 'access_y', label: 'Y access', group: 'Foo pack' });
    // null means unlimited and is not the same as 0 (TW-ADD-013 acceptance)
    expect(map.planLimits.map((l) => [l.key, l.default])).toEqual([
      ['y_seats', 5],
      ['y_unlimited', null],
      ['y_zero', 0],
    ]);
  });

  it('drops route paths that are absolute or climb out of the package', () => {
    const m = parse({ slug: 'foo', routes: ['routes/a.php', '../core.php', '/etc/passwd', 'a/../../b', 7] })!;
    expect(m.routes).toEqual(['routes/a.php']);
  });

  it('round-trips through the stored (normalised) form', () => {
    const m = parse({
      slug: 'foo',
      version: '2.1.0',
      min_core: '0.1.0',
      nav: { admin: [{ key: 'a', href: '/admin/a', label: 'A', icon: 'chart' }] },
      plan_features: { access_y: { label: 'Y', group: 'G' } },
      plan_limits: { y_seats: { default: null } },
    })!;
    expect(readStoredManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(readStoredManifest(null)).toBeNull();
    expect(readStoredManifest({ slug: '../x' })).toBeNull();
  });

  it('toLocalPath never returns an absolute URL', () => {
    expect(toLocalPath('/admin/x?y=1')).toBe('/admin/x?y=1');
    expect(toLocalPath('admin/x')).toBe('/admin/x');
    expect(toLocalPath('https://evil.test/a/b')).toBe('/a/b');
    expect(toLocalPath('//evil.test/a')).toBe('/a');
    expect(toLocalPath('/a/../b')).toBeNull();
    expect(toLocalPath('   ')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders numerically, not as text', () => {
    expect(compareVersions('1.7.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
  });
  it('sorts a pre-release before its release', () => {
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.0', '1.2.0-rc1')).toBeGreaterThan(0);
  });
});
