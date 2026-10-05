import { describe, expect, it } from 'vitest';
import { ID, attribution, touch } from '../test-fixtures';
import { attributionView } from './attribution-view';

describe('attributionView', () => {
  it('renders nothing for a contact that never came through a lead source', () => {
    expect(attributionView(undefined)).toBeNull();
    expect(attributionView({ first: null, latest: null, touches: [], total: 0 })).toBeNull();
    expect(attributionView({ first: null, latest: null, touches: [], total: 2 })).toBeNull();
  });

  it('one touch is first and latest at once', () => {
    const v = attributionView(attribution())!;
    expect(v.single).toBe(true);
    expect(v.total).toBe(1);
    expect(v.first.details).toEqual([
      { field: 'campaign', value: 'Launch' },
      { field: 'adset', value: 'AS-1' },
      { field: 'ad', value: 'Ad-1' },
      { field: 'form', value: 'F-1' },
    ]);
    expect(v.first.sourceHref).toBe(`/lead-sources/${ID(1)}`);
  });

  it('two touches are shown apart, with the total', () => {
    const first = touch({ id: ID(1), campaign: 'Launch' });
    const latest = touch({
      id: ID(2),
      campaign: 'Retarget',
      capturedAt: '2026-10-02T10:00:00.000Z',
    });
    const v = attributionView({ first, latest, touches: [latest, first], total: 2 })!;
    expect(v.single).toBe(false);
    expect(v.total).toBe(2);
    expect(v.first.details[0]).toEqual({ field: 'campaign', value: 'Launch' });
    expect(v.latest.details[0]).toEqual({ field: 'campaign', value: 'Retarget' });
  });

  it('leaves out blank values and the link of a deleted source', () => {
    const t = touch({
      campaign: null,
      adset: '  ',
      ad: null,
      form: null,
      leadSourceId: null,
      platform: null,
    });
    const v = attributionView(attribution({ first: t, latest: t }))!;
    expect(v.first.details).toEqual([]);
    expect(v.first.sourceHref).toBeNull();
    expect(v.first.platform).toBeNull();
    expect(v.first.sourceLabel).toBe('facebook');
  });

  it('copes with a response that has only one of first and latest', () => {
    const t = touch();
    expect(attributionView({ first: t, latest: null, touches: [t], total: 1 })?.single).toBe(true);
    expect(attributionView({ first: null, latest: t, touches: [t], total: 1 })?.single).toBe(true);
  });
});
