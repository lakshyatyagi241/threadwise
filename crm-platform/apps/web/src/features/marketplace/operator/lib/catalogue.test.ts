import { describe, expect, it } from 'vitest';
import { ID, app, category } from '../test-fixtures';
import {
  ALL_CATEGORIES,
  NO_FILTERS,
  categoryKey,
  categoryOptions,
  filterByCategory,
  listQuery,
  statusCounts,
} from './catalogue';
import { listingHref } from './paths';

describe('listQuery: what the API filters itself', () => {
  it('sends nothing for no filters', () => {
    expect(listQuery(NO_FILTERS)).toEqual({});
  });

  it('sends status, kind and the trimmed search, and never the category', () => {
    expect(
      listQuery({
        status: 'in_review',
        kind: 'integration',
        category: 'integration:payments',
        search: '  acme ',
      }),
    ).toEqual({ status: 'in_review', kind: 'integration', q: 'acme' });
  });

  it('keeps the search within the API limit of 80 characters', () => {
    expect(listQuery({ ...NO_FILTERS, search: 'x'.repeat(200) }).q).toHaveLength(80);
    expect(listQuery({ ...NO_FILTERS, search: '   ' })).toEqual({});
  });
});

describe('category filter over the loaded rows', () => {
  const rows = [
    app({
      id: ID(1),
      slug: 'a',
      kind: 'integration',
      category: { slug: 'automation', name: 'Automation (Zapier)' },
    }),
    app({
      id: ID(2),
      slug: 'b',
      kind: 'mini_app',
      category: { slug: 'automation', name: 'Automation' },
    }),
    app({
      id: ID(3),
      slug: 'c',
      kind: 'integration',
      category: { slug: 'payments', name: 'Payments' },
    }),
  ];

  it('all keeps every row', () => {
    expect(filterByCategory(rows, ALL_CATEGORIES)).toHaveLength(3);
  });

  it('a slug is only unique inside its kind: automation of integrations is not automation of mini apps', () => {
    expect(
      filterByCategory(rows, categoryKey('integration', 'automation')).map((r) => r.slug),
    ).toEqual(['a']);
    expect(
      filterByCategory(rows, categoryKey('mini_app', 'automation')).map((r) => r.slug),
    ).toEqual(['b']);
  });

  it('a category with no loaded row is empty', () => {
    expect(filterByCategory(rows, categoryKey('integration', 'telephony'))).toEqual([]);
  });
});

describe('statusCounts: the KPI tiles over the loaded rows', () => {
  it('counts every status, and the total', () => {
    const rows = [
      app({ status: 'published' }),
      app({ status: 'published' }),
      app({ status: 'in_review' }),
      app({ status: 'killed' }),
      app({ status: 'draft' }),
    ];
    expect(statusCounts(rows)).toEqual({
      all: 5,
      draft: 1,
      in_review: 1,
      published: 2,
      hidden: 0,
      killed: 1,
    });
    expect(statusCounts([])).toEqual({
      all: 0,
      draft: 0,
      in_review: 0,
      published: 0,
      hidden: 0,
      killed: 0,
    });
  });
});

describe('categoryOptions', () => {
  it('lists mini app categories first, each kind in the operator order', () => {
    const options = categoryOptions([
      category({ kind: 'integration', slug: 'payments', name: 'Payments', sortOrder: 50 }),
      category({ kind: 'mini_app', slug: 'utilities', name: 'Utilities', sortOrder: 80 }),
      category({ kind: 'integration', slug: 'lead-sources', name: 'Lead sources', sortOrder: 10 }),
      category({ kind: 'mini_app', slug: 'sales-tools', name: 'Sales tools', sortOrder: 10 }),
    ]);
    expect(options.map((o) => o.value)).toEqual([
      'mini_app:sales-tools',
      'mini_app:utilities',
      'integration:lead-sources',
      'integration:payments',
    ]);
  });
});

describe('listingHref', () => {
  it('links by slug, and by uuid when the slug is a word the console uses for another page', () => {
    expect(listingHref({ slug: 'acme-leads', id: ID(1) })).toBe('/admin/marketplace/acme-leads');
    for (const slug of ['new', 'categories', 'requests', 'usage']) {
      expect(listingHref({ slug, id: ID(7) })).toBe(`/admin/marketplace/${ID(7)}`);
    }
  });
});
