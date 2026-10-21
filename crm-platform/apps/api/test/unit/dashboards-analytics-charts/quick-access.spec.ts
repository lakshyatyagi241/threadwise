import { describe, expect, it } from 'vitest';
import {
  effectiveQuickAccess,
  quickAccessTiles,
  sanitizeQuickAccess,
} from '../../../src/modules/dashboards-analytics-charts/quick-access';

describe('quick access (TW-DASH-009)', () => {
  it('a user who never customised gets the nine defaults, in order (no Broadcasts tile)', () => {
    const items = effectiveQuickAccess(null);
    expect(items.map((i) => ('key' in i ? i.key : ''))).toEqual([
      'inbox',
      'contacts',
      'campaigns',
      'templates',
      'flows',
      'scheduled',
      'catalog',
      'deals',
      'analytics',
    ]);
  });

  it('only the first 10 of 12 valid items are kept', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, url: `/p${i}` }));
    const out = sanitizeQuickAccess(twelve);
    expect(out).toHaveLength(10);
    expect(out[9]).toEqual({ label: 'L9', url: '/p9' });
  });

  it('drops javascript: links, unknown keys, non-arrays and entries without label and url', () => {
    expect(sanitizeQuickAccess([{ label: 'X', url: 'javascript:alert(1)' }])).toEqual([]);
    expect(sanitizeQuickAccess([{ key: 'nope' }, { label: 'a' }, 'str', [1]])).toEqual([]);
    expect(sanitizeQuickAccess('inbox')).toEqual([]);
    expect(
      sanitizeQuickAccess([{ label: 'ok', url: 'https://x.test/a' }, { key: 'inbox' }]),
    ).toHaveLength(2);
  });

  it('truncates a 60-char label to 40 and a long url to 255', () => {
    const [i] = sanitizeQuickAccess([{ label: 'a'.repeat(60), url: '/' + 'b'.repeat(300) }]);
    expect('label' in i! && i.label.length).toBe(40);
    expect('url' in i! && i.url.length).toBe(255);
  });

  it('an empty saved list reads as never customised (Reference quirk, kept)', () => {
    // the same nine defaults as a user who never saved (10 was the count while Broadcasts had a tile; it moved under Campaigns)
    expect(effectiveQuickAccess([])).toHaveLength(9);
    expect(effectiveQuickAccess([])).toEqual(effectiveQuickAccess(null));
  });

  it('keeps duplicates and turns items into tiles with catalog copy', () => {
    const tiles = quickAccessTiles(
      sanitizeQuickAccess([{ key: 'inbox' }, { key: 'inbox' }, { label: 'Mine', url: '/m' }]),
    );
    expect(tiles.map((t) => t.label)).toEqual(['Unified Inbox', 'Unified Inbox', 'Mine']);
    expect(tiles[2]).toMatchObject({ custom: true, desc: 'Open Mine' });
  });
});
