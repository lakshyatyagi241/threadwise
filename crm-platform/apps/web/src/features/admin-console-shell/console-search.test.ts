import { describe, expect, it } from 'vitest';
import { CONSOLE_KEYWORDS } from './console-keywords';
import { buildConsoleNav, CONSOLE_NAV_ITEMS } from './console-nav';
import type { ConsoleEntry } from './console-nav';
import {
  buildSearchIndex,
  DEFAULT_RESULTS,
  defaultEntries,
  makeSearchEntry,
  MAX_RESULTS,
  normalize,
  searchEntries,
} from './console-search';

const ids = (list: Array<{ id: string }>) => list.map((e) => e.id);

describe('normalize', () => {
  it('lower-cases and strips accents', () => {
    expect(normalize('  Café Déjà ')).toBe('cafe deja');
  });

  it('strips Arabic vowel marks so a marked word finds its bare form', () => {
    expect(normalize('الأَمان')).toBe(normalize('الأمان'));
  });
});

describe('buildSearchIndex', () => {
  const entries: ConsoleEntry[] = [
    { id: 'overview', href: '/admin', labelKey: 'k.overview' },
    {
      id: 'billing',
      labelKey: 'k.billing',
      children: [
        { id: 'orders', href: '/admin/order-history', labelKey: 'k.orders', captionKey: 'k.cap' },
        { id: 'invoices', href: '/admin/invoices', labelKey: 'k.invoices' },
        { id: 'module-x-reports', href: '/admin/reports', labelKey: '', label: 'Reports' },
      ],
    },
  ];
  const text = (key: string) => `T(${key})`;
  const index = buildSearchIndex(entries, text);

  it('lists every page in menu order, including a link outside the sections', () => {
    expect(ids(index)).toEqual(['overview', 'orders', 'invoices', 'module-x-reports']);
    expect(index[0]).toMatchObject({ label: 'T(k.overview)', section: '', caption: '' });
  });

  it('gives each page its hub and the heading of the group it belongs to', () => {
    expect(index[1]).toMatchObject({ section: 'T(k.billing)', caption: 'T(k.cap)' });
    // Only the first page of a group carries the heading key; the rest keep the group they follow.
    expect(index[2]).toMatchObject({ caption: 'T(k.cap)' });
  });

  it('uses the literal label of a module page', () => {
    expect(index[3]!.label).toBe('Reports');
  });
});

describe('searchEntries', () => {
  const index = [
    makeSearchEntry('plans', '/admin/plans', 'Plans', 'Plans & pricing'),
    makeSearchEntry(
      'workspace-plans',
      '/admin/workspace-plans',
      'Workspace plans',
      'Plans & pricing',
    ),
    makeSearchEntry('coupons', '/admin/coupons', 'Coupons', 'Plans & pricing'),
    makeSearchEntry(
      'ai-keys',
      '/admin/api-keys',
      'AI provider keys',
      'Platform settings',
      'Integrations',
    ),
    makeSearchEntry(
      'invoices',
      '/admin/invoices',
      'Invoices',
      'Billing & revenue',
      'Orders and invoices',
    ),
    makeSearchEntry(
      'orders',
      '/admin/order-history',
      'Order history',
      'Billing & revenue',
      'Orders and invoices',
    ),
    makeSearchEntry(
      'security',
      '/admin/security',
      'Security Center',
      'Access & security',
      'Security',
    ),
    makeSearchEntry('cafe', '/admin/cafe', 'Café menu'),
  ];

  it('returns nothing for an empty or blank query', () => {
    expect(searchEntries(index, '')).toEqual([]);
    expect(searchEntries(index, '   ')).toEqual([]);
  });

  it('ranks an exact name first, then names that start with the query, then names that contain it', () => {
    expect(ids(searchEntries(index, 'plans'))).toEqual(['plans', 'workspace-plans', 'coupons']);
  });

  it('puts a name hit above a hit that is only in the section heading', () => {
    // "Security Center" is named for it; "Access & security" pages only share the section.
    const withSibling = [
      ...index,
      makeSearchEntry('roles', '/admin/roles', 'Roles', 'Access & security', 'Roles'),
    ];
    expect(ids(searchEntries(withSibling, 'security'))[0]).toBe('security');
    expect(ids(searchEntries(withSibling, 'security'))).toContain('roles');
  });

  it('needs every word to match somewhere, in any order', () => {
    expect(ids(searchEntries(index, 'history order'))).toEqual(['orders']);
    expect(searchEntries(index, 'order wallet')).toEqual([]);
  });

  it('finds a page by the words of its address as well as its name', () => {
    expect(ids(searchEntries(index, 'api keys'))).toEqual(['ai-keys']);
  });

  it('finds a page by its block heading', () => {
    expect(ids(searchEntries(index, 'orders and invoices'))).toEqual(['invoices', 'orders']);
  });

  it('ignores accents and case in both the query and the names', () => {
    expect(ids(searchEntries(index, 'CAFÉ'))).toEqual(['cafe']);
    expect(ids(searchEntries(index, 'cafe'))).toEqual(['cafe']);
  });

  it('keeps menu order between equal matches', () => {
    expect(ids(searchEntries(index, 'billing'))).toEqual(['invoices', 'orders']);
  });

  it('lists at most 12 matches by default, as WaDesk does', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeSearchEntry(`p${i}`, `/admin/p${i}`, `Page ${i}`),
    );
    expect(MAX_RESULTS).toBe(12);
    expect(searchEntries(many, 'page')).toHaveLength(12);
  });

  it('finds a page by a hidden keyword that is not in its name, and never shows it', () => {
    const gateways = makeSearchEntry(
      'payment-gateways',
      '/admin/payment-gateways',
      'Payment gateways',
      'Billing & revenue',
      'Payments',
      'stripe razorpay paypal',
    );
    expect(ids(searchEntries([gateways, ...index], 'stripe'))).toEqual(['payment-gateways']);
    expect(gateways.label).not.toMatch(/stripe/i);
  });

  it('ranks a name hit above a keyword-only hit', () => {
    const byName = makeSearchEntry('mail', '/admin/settings/mail', 'Mail');
    const byKeyword = makeSearchEntry(
      'general',
      '/admin/settings/general',
      'General',
      '',
      '',
      'mail',
    );
    expect(ids(searchEntries([byKeyword, byName], 'mail'))).toEqual(['mail', 'general']);
  });

  it('caps the result list', () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      makeSearchEntry(`p${i}`, `/admin/p${i}`, `Page ${i}`),
    );
    expect(searchEntries(many, 'page', 7)).toHaveLength(7);
  });

  it('matches nothing for a word that appears nowhere', () => {
    expect(searchEntries(index, 'zzz')).toEqual([]);
  });
});

describe('defaultEntries', () => {
  it('is the first eight pages of the menu, in order, before anything is typed', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      makeSearchEntry(`p${i}`, `/admin/p${i}`, `Page ${i}`),
    );
    expect(DEFAULT_RESULTS).toBe(8);
    expect(ids(defaultEntries(many))).toEqual(ids(many.slice(0, 8)));
  });

  it('is shorter when the menu is', () => {
    expect(defaultEntries([makeSearchEntry('a', '/admin/a', 'A')])).toHaveLength(1);
  });
});

describe('the real menu', () => {
  const nav = buildConsoleNav(CONSOLE_NAV_ITEMS);
  // The key itself stands in for the English label, which is enough to check what is reachable.
  const index = buildSearchIndex(
    nav,
    (key) => key,
    (id) => CONSOLE_KEYWORDS[id] ?? '',
  );

  it('indexes every page the rail has, once', () => {
    const leafCount = nav.flatMap((e) => ('children' in e ? e.children : [e])).length;
    expect(index).toHaveLength(leafCount);
    expect(new Set(ids(index)).size).toBe(index.length);
  });

  it('finds the WhatsApp provider pages by the word "whatsapp" through their address and section', () => {
    expect(ids(searchEntries(index, 'whatsapp'))).toEqual(
      expect.arrayContaining(['wap-providers', 'wap-switch']),
    );
  });

  it.each([
    ['stripe', 'payment-gateways'],
    ['smtp', 'settings-mail'],
    ['openai', 'ai-keys'],
    ['two factor', 'security'],
    ['coupon code', 'coupons'],
    ['arabic', 'i18n-languages'],
  ])('finds the page that configures "%s"', (query, id) => {
    expect(ids(searchEntries(index, query))).toContain(id);
  });

  it('finds the wallet pages by "wallet"', () => {
    expect(ids(searchEntries(index, 'wallet'))).toEqual(
      expect.arrayContaining([
        'wallet-pricing',
        'wallet-margins',
        'wallet-packages',
        'wallet-logs',
      ]),
    );
  });
});
