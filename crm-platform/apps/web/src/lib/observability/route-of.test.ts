import { describe, expect, it } from 'vitest';
import { webRouteOf } from './route-of';

const route = (url: string, status = 200, method = 'GET') => webRouteOf({ method, url }, status);

describe('webRouteOf (EL-B20)', () => {
  it('keeps plain route names and drops the query string', () => {
    expect(route('/')).toBe('/');
    expect(route('/login?next=%2Fcontacts')).toBe('/login');
    expect(route('/contacts/import')).toBe('/contacts/import');
    expect(route('/settings/billing/')).toBe('/settings/billing');
  });

  it('turns values into :id: numbers, UUIDs, long hex, long mixed tokens', () => {
    expect(route('/contacts/12345')).toBe('/contacts/:id');
    expect(route('/inbox/8f14e45f-ceea-467a-9575-1c1f3b6c9a10')).toBe('/inbox/:id');
    expect(route('/f/5d41402abc4b2a76b9719d911017c592')).toBe('/f/:id');
    expect(route('/l/Xk3pQ9aLm2Zr8tVb1NcYw7Ud')).toBe('/l/:id');
    expect(route('/b/abc123def456')).toBe('/b/:id'); // mixed letters and digits, 12 characters
    expect(route('/templates/welcome-message')).toBe('/templates/welcome-message');
    expect(route('/orders/ORD-1234')).toBe('/orders/:id'); // a digit makes it a value
    expect(route('/x123')).toBe('/:id');
    expect(route('/api/v2/contacts')).toBe('/api/v2/contacts'); // version prefixes stay
    expect(route('/message-templates')).toBe('/message-templates'); // long kebab-case names stay
    expect(route('/abcdefghijklmnopqrstu')).toBe('/:id'); // 21 letters, no hyphen
  });

  it('cuts long paths at four segments', () => {
    expect(route('/a/b/c/d/e/f')).toBe('/a/b/c/d/*');
    expect(route('/a/b/c/d')).toBe('/a/b/c/d');
  });

  it("folds Next's own URLs", () => {
    expect(route('/_next/static/chunks/app/page-abc123.js')).toBe('/_next/static/*');
    expect(route('/_next/image?url=%2Fx.png&w=64&q=75')).toBe('/_next/image');
    expect(route('/_next/data/build-id/contacts.json')).toBe('/_next/data/*');
    expect(route('/_next/webpack-hmr')).toBe('/_next/*');
  });

  it('collapses every 404 to "unmatched", so scanners cannot create series', () => {
    expect(route('/wp-admin/setup-config.php', 404)).toBe('unmatched');
    expect(route('/.env', 404)).toBe('unmatched');
    expect(route('/contacts/12345', 404)).toBe('unmatched');
    expect(route('/contacts/12345', 200)).toBe('/contacts/:id');
  });

  it('does not measure the metrics listener itself', () => {
    expect(route('/metrics')).toBeNull();
    expect(route('/metrics?x=1')).toBeNull();
  });

  it('bounds the number of distinct templates a flood of random URLs can make', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i++) {
      const token = Math.floor(Math.random() * 36 ** 12).toString(36);
      seen.add(route(`/${token}/${i}/x${i}/${token}?q=${i}`)!);
      seen.add(route(`/probe-${i}`, 404)!);
    }
    expect(seen.size).toBeLessThan(10);
  });

  it('survives hostile paths', () => {
    expect(() => route('/%E0%A4%A')).not.toThrow();
    expect(route('//')).toBe('/');
    expect(route('/' + 'a'.repeat(5_000))).toBe('/:id');
    expect(route('/a b/<script>')).toBe('/:id/:id');
  });
});
