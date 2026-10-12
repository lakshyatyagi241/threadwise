import { describe, expect, it } from 'vitest';
import type { ResolvedSettingsTile } from '@/features/_registry/settings-types';
import {
  fold,
  queryTokens,
  searchTiles,
  splitKeywords,
  type SearchableTile,
} from './settings-search';

const entry = (
  id: string,
  label: string,
  over: Partial<Omit<SearchableTile, 'tile'>> & { soon?: boolean; order?: number } = {},
): SearchableTile => ({
  tile: {
    id,
    section: 'business',
    labelKey: id,
    href: `/${id}`,
    icon: 'x',
    order: over.order,
    locked: false,
    comingSoon: over.soon ?? false,
  } as ResolvedSettingsTile,
  label,
  description: over.description ?? '',
  keywords: over.keywords ?? [],
  sectionTitle: over.sectionTitle ?? 'Business and billing',
});

const ids = (hits: ReturnType<typeof searchTiles>) => hits.map((h) => h.entry.tile.id);

describe('splitKeywords', () => {
  it('splits on commas, semicolons and Arabic commas and trims', () => {
    expect(splitKeywords('vat, gst ; sales tax،ضريبة')).toEqual([
      'vat',
      'gst',
      'sales tax',
      'ضريبة',
    ]);
  });
  it('gives nothing for an empty message', () => {
    expect(splitKeywords('')).toEqual([]);
    expect(splitKeywords(undefined)).toEqual([]);
  });
});

describe('fold', () => {
  it('lower-cases and strips accents, keeping an index map to the original', () => {
    const { folded, map } = fold('Café Ünï');
    expect(folded).toBe('cafe uni');
    expect(map).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('strips Arabic marks so a vowelled word matches the plain one', () => {
    expect(fold('الضَّرِيبَة').folded).toBe(fold('الضريبة').folded);
  });
  it('splits a query into folded words', () => {
    expect(queryTokens('  Tax   RATES ')).toEqual(['tax', 'rates']);
    expect(queryTokens('   ')).toEqual([]);
  });
});

describe('searchTiles', () => {
  const entries = [
    entry('tax', 'Tax rates', {
      keywords: ['vat', 'gst'],
      description: 'Set the taxes added to your invoices.',
    }),
    entry('biz', 'Business profile', { description: 'Your company name, address and tax number.' }),
    entry('orders', 'Order history', { keywords: ['receipts', 'tax invoices'] }),
    entry('contact-tax', 'Contact stages', { sectionTitle: 'Data and customization' }),
    entry('whatsapp', 'WhatsApp', { soon: true, keywords: ['wa'] }),
    entry('plans', 'Plan and usage'),
  ];

  it('returns nothing for a blank query', () => {
    expect(searchTiles(entries, '')).toEqual([]);
    expect(searchTiles(entries, '   ')).toEqual([]);
  });

  it('matches by label, by keyword and by help line, and ignores the rest', () => {
    expect(ids(searchTiles(entries, 'vat'))).toEqual(['tax']);
    expect(ids(searchTiles(entries, 'receipts'))).toEqual(['orders']);
    expect(ids(searchTiles(entries, 'address'))).toEqual(['biz']);
    expect(searchTiles(entries, 'zzz')).toEqual([]);
  });

  it('ranks a label match above a keyword above a help line', () => {
    expect(ids(searchTiles(entries, 'tax'))).toEqual(['tax', 'orders', 'biz']);
  });

  it('ranks exact, then prefix, then word start, then inside a word', () => {
    const list = [
      entry('inside', 'Backstage tools'),
      entry('word', 'Contact stages'),
      entry('prefix', 'Stage rules'),
      entry('exact', 'Stage'),
    ];
    expect(ids(searchTiles(list, 'stage'))).toEqual(['exact', 'prefix', 'word', 'inside']);
  });

  it('needs every word typed to match somewhere', () => {
    expect(ids(searchTiles(entries, 'tax rates'))).toEqual(['tax']);
    expect(searchTiles(entries, 'tax whatsapp')).toEqual([]);
  });

  it('finds a tile by the title of its section', () => {
    expect(ids(searchTiles(entries, 'customization'))).toEqual(['contact-tax']);
  });

  it('puts built screens before Soon tiles on equal scores, then follows the tile order', () => {
    const list = [
      entry('b-soon', 'Messages', { soon: true, order: 0 }),
      entry('b-late', 'Messages', { order: 20 }),
      entry('b-early', 'Messages', { order: 10 }),
    ];
    expect(ids(searchTiles(list, 'messages'))).toEqual(['b-early', 'b-late', 'b-soon']);
  });

  it('is case and accent insensitive', () => {
    expect(ids(searchTiles([entry('a', 'Café')], 'CAFE'))).toEqual(['a']);
    expect(ids(searchTiles([entry('a', 'الضَّرِيبَة')], 'الضريبة'))).toEqual(['a']);
  });

  it("reports the label ranges to highlight, in the label's own characters", () => {
    const [hit] = searchTiles([entry('a', 'Tax rates')], 'tax');
    expect(hit!.ranges).toEqual([[0, 3]]);
    const [two] = searchTiles([entry('a', 'Tax rates')], 'rat tax');
    expect(two!.ranges).toEqual([
      [0, 3],
      [4, 7],
    ]);
    const [accent] = searchTiles([entry('a', 'Café stages')], 'stage');
    expect(accent!.ranges).toEqual([[5, 10]]);
  });

  it('reports no highlight when the word hit a keyword or help line, not the label', () => {
    const [hit] = searchTiles(entries, 'vat');
    expect(hit!.ranges).toEqual([]);
  });

  it('merges overlapping highlights', () => {
    const [hit] = searchTiles([entry('a', 'Contact properties')], 'con conta');
    expect(hit!.ranges).toEqual([[0, 5]]);
  });
});
