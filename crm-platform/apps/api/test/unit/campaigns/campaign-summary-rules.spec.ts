import { describe, expect, it } from 'vitest';
import { campaignSummaryPeopleQuerySchema, campaignSummaryQuerySchema } from '@crm/contracts';
import { pct } from '../../../src/modules/campaigns/campaign-rules';
import {
  cacheKey,
  caveatsOf,
  dayBuckets,
  decodeCursor,
  encodeCursor,
  secondsToHours,
  utcDay,
  windowBounds,
} from '../../../src/modules/campaigns/summary/campaign-summary-rules';

const at = (s: string) => new Date(s);

describe('the percentages of the summary', () => {
  it('rounds to one decimal and never divides by zero', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(5, 0)).toBe(0);
    expect(pct(0, 10)).toBe(0);
    expect(pct(10, 10)).toBe(100);
  });
});

describe('the median hours to reply', () => {
  it('turns the database median in seconds into hours with one decimal', () => {
    expect(secondsToHours(5400)).toBe(1.5);
    expect(secondsToHours(3600)).toBe(1);
    expect(secondsToHours(100)).toBe(0);
    expect(secondsToHours(86_400 * 2 + 1800)).toBe(48.5);
  });
});

describe('windowBounds', () => {
  it('runs from the first send to the last send plus the window', () => {
    const b = windowBounds(at('2026-10-01T10:00:00Z'), at('2026-10-01T12:00:00Z'), 7);
    expect(b?.from.toISOString()).toBe('2026-10-01T10:00:00.000Z');
    expect(b?.to.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('is null when nothing was sent', () => {
    expect(windowBounds(null, null, 3)).toBeNull();
    expect(windowBounds(at('2026-10-01T10:00:00Z'), null, 3)).toBeNull();
  });
});

describe('utcDay and dayBuckets', () => {
  it('names the UTC day, not the local one', () => {
    expect(utcDay(at('2026-10-01T23:59:59Z'))).toBe('2026-10-01');
    expect(utcDay(at('2026-10-02T00:00:00Z'))).toBe('2026-10-02');
  });

  it('sorts oldest first and keeps at most 31 days', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      day: utcDay(new Date(Date.UTC(2026, 9, 1 + i))),
      count: i + 1,
    })).reverse();
    const out = dayBuckets(rows);
    expect(out).toHaveLength(31);
    expect(out[0]).toEqual({ day: '2026-10-01', count: 1 });
    expect(out[30]!.day).toBe('2026-10-31');
  });
});

describe('caveatsOf', () => {
  const none = {
    notTrackable: 0,
    hasFilledForm: false,
    optedOutWroteBack: false,
    inOtherCampaigns: false,
  };

  it('says nothing when every number is whole', () => {
    expect(caveatsOf(none)).toEqual([]);
  });

  it('lists each reason once, in the order the screen reads them', () => {
    expect(
      caveatsOf({
        notTrackable: 2,
        hasFilledForm: true,
        optedOutWroteBack: true,
        inOtherCampaigns: true,
      }),
    ).toEqual([
      'recipients_without_contact',
      'contact_match_only',
      'opted_out_excluded',
      'counted_in_other_campaigns',
    ]);
    expect(caveatsOf({ ...none, hasFilledForm: true })).toEqual(['contact_match_only']);
  });
});

describe('cacheKey', () => {
  it('is per workspace, kind, id, window and picked forms', () => {
    const a = cacheKey(1, 'campaign', 'c1', 7, []);
    expect(a).toBe('camp-summary:1:campaign:c1:7:all');
    expect(cacheKey(2, 'campaign', 'c1', 7, [])).not.toBe(a);
    expect(cacheKey(1, 'broadcast', 'c1', 7, [])).not.toBe(a);
    expect(cacheKey(1, 'campaign', 'c1', 14, [])).not.toBe(a);
  });

  it('treats the same forms in any order, or twice, as one entry', () => {
    const one = cacheKey(1, 'campaign', 'c1', 7, ['b', 'a']);
    expect(cacheKey(1, 'campaign', 'c1', 7, ['a', 'b', 'a'])).toBe(one);
    expect(cacheKey(1, 'campaign', 'c1', 7, ['a'])).not.toBe(one);
    expect(one).not.toContain('a,b');
  });
});

describe('the people cursor', () => {
  it('round-trips an instant and a key', () => {
    const c = { at: '1790000000123456', key: '42' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ at: null, key: 'p:919' }))).toEqual({
      at: null,
      key: 'p:919',
    });
  });

  it('is no cursor when absent', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('refuses anything that is not one of ours with a validation error', () => {
    const bad = (raw: string) =>
      expect(() => decodeCursor(raw)).toThrowError(/cursor is not valid/);
    bad('not base64 json!');
    bad(Buffer.from('{"a":1}').toString('base64url'));
    bad(Buffer.from('["12;DROP",1]').toString('base64url'));
    bad(Buffer.from('["12",""]').toString('base64url'));
    bad(Buffer.from(JSON.stringify(['1', 'x'.repeat(81)])).toString('base64url'));
  });
});

describe('the summary queries', () => {
  it('defaults to a 7 day window and all forms', () => {
    const q = campaignSummaryQuerySchema.parse({});
    expect(q.cameBackDays).toBe(7);
    expect(q.formIds).toEqual([]);
  });

  it('accepts only 3, 7 or 14 days', () => {
    expect(campaignSummaryQuerySchema.parse({ cameBackDays: '3' }).cameBackDays).toBe(3);
    expect(campaignSummaryQuerySchema.parse({ cameBackDays: '14' }).cameBackDays).toBe(14);
    for (const v of ['5', '0', '30', 'x'])
      expect(campaignSummaryQuerySchema.safeParse({ cameBackDays: v }).success).toBe(false);
  });

  it('reads comma-separated form uuids and refuses a bad one', () => {
    const a = '3f2b8f0e-2f6e-4a5b-9d0e-6c1b7a9a1111';
    const b = '3f2b8f0e-2f6e-4a5b-9d0e-6c1b7a9a2222';
    expect(campaignSummaryQuerySchema.parse({ formIds: `${a}, ${b}` }).formIds).toEqual([a, b]);
    expect(campaignSummaryQuerySchema.safeParse({ formIds: 'nope' }).success).toBe(false);
  });

  it('caps a page of people at 100', () => {
    expect(campaignSummaryPeopleQuerySchema.parse({ kind: 'came_back' }).limit).toBe(25);
    expect(
      campaignSummaryPeopleQuerySchema.safeParse({ kind: 'came_back', limit: '101' }).success,
    ).toBe(false);
    expect(campaignSummaryPeopleQuerySchema.safeParse({ kind: 'other' }).success).toBe(false);
  });
});
