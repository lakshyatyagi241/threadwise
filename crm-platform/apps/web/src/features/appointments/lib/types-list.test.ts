import { describe, expect, it } from 'vitest';
import type { BookingType } from '../api/schemas';
import { filterTypes } from './types-list';

const t = (name: string, slug: string, isActive: boolean, description: string | null = null) =>
  ({ id: slug, name, slug, isActive, description }) as unknown as BookingType;

const LIST = [
  t('Discovery call', 'discovery-call', true, 'A quick intro'),
  t('Site visit', 'site-visit', true),
  t('Workshop', 'group-workshop', false),
];

describe('filterTypes', () => {
  it('keeps everything and the order with no filter', () => {
    expect(filterTypes(LIST, '', 'all').map((x) => x.id)).toEqual([
      'discovery-call',
      'site-visit',
      'group-workshop',
    ]);
  });

  it('filters by status', () => {
    expect(filterTypes(LIST, '', 'active').map((x) => x.id)).toEqual([
      'discovery-call',
      'site-visit',
    ]);
    expect(filterTypes(LIST, '', 'paused').map((x) => x.id)).toEqual(['group-workshop']);
  });

  it('searches name, slug and description without case', () => {
    expect(filterTypes(LIST, ' SITE ', 'all').map((x) => x.id)).toEqual(['site-visit']);
    expect(filterTypes(LIST, 'group-', 'all').map((x) => x.id)).toEqual(['group-workshop']);
    expect(filterTypes(LIST, 'intro', 'all').map((x) => x.id)).toEqual(['discovery-call']);
    expect(filterTypes(LIST, 'nothing', 'all')).toEqual([]);
  });

  it('combines both', () => {
    expect(filterTypes(LIST, 'work', 'active')).toEqual([]);
    expect(filterTypes(LIST, 'work', 'paused')).toHaveLength(1);
  });
});
