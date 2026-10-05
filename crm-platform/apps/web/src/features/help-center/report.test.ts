import { describe, expect, it } from 'vitest';
import { pendingCount, renderPending } from './report';

describe('renderPending', () => {
  it('starts with a machine-readable count the hooks read', () => {
    const out = renderPending(
      [
        { unit: 'nav:contacts', domain: 'contacts-attributes-tags', owner: 'punya' },
        { unit: 'tile:tax-rates', domain: 'invoicing', owner: 'punya' },
        { unit: 'feature:automation', domain: 'plans-subscriptions-trials', owner: 'lakshya' },
      ],
      { stale: [], bad: [] },
    );
    expect(out.split('\n')[0]).toBe('<!-- help-pending: 3 -->');
    expect(pendingCount(out)).toBe(3);
  });

  it('groups units under their domain and owner, owners and domains in order', () => {
    const out = renderPending(
      [
        { unit: 'nav:b', domain: 'zeta', owner: 'punya' },
        { unit: 'nav:a', domain: 'alpha', owner: 'vedant' },
        { unit: 'nav:c', domain: 'alpha', owner: 'vedant' },
        { unit: 'nav:d', domain: 'mid', owner: 'lakshya' },
      ],
      { stale: [], bad: [] },
    );
    expect(out.indexOf('## mid (lakshya)')).toBeLessThan(out.indexOf('## zeta (punya)'));
    expect(out.indexOf('## zeta (punya)')).toBeLessThan(out.indexOf('## alpha (vedant)'));
    expect(out).toMatch(/## alpha \(vedant\)\n\n- nav:a\n- nav:c\n/);
  });

  it('says so when nothing is pending', () => {
    const out = renderPending([], { stale: [], bad: [] });
    expect(out.split('\n')[0]).toBe('<!-- help-pending: 0 -->');
    expect(out).toContain('All features have help guides.');
    expect(pendingCount(out)).toBe(0);
  });

  it('lists problems in pending.json', () => {
    const out = renderPending([], { stale: ['nav:x'], bad: ['tile:y'] });
    expect(out).toContain('Problems in pending.json');
    expect(out).toContain('nav:x');
    expect(out).toContain('tile:y');
  });
});

describe('pendingCount', () => {
  it('reads the first line, and is 0 for anything else', () => {
    expect(pendingCount('<!-- help-pending: 12 -->\n# x')).toBe(12);
    expect(pendingCount('nonsense')).toBe(0);
    expect(pendingCount('')).toBe(0);
  });
});
