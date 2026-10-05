import { describe, expect, it } from 'vitest';
import { grandfatherSubscriptionsSchema, type MarketGrandfatherResult } from '@crm/contracts';
import { ID } from '../test-fixtures';
import {
  grandfatherCheck,
  grandfatherPayload,
  grandfatherPreview,
  initialGrandfatherDraft,
  type GrandfatherDraft,
} from './grandfather';

const ok: GrandfatherDraft = { duration: 'months', months: '6', note: 'Had it before it was paid' };

describe('the grandfather form', () => {
  it('starts as "until I end it", with a note still to write', () => {
    expect(initialGrandfatherDraft()).toEqual({ duration: 'open', months: '12', note: '' });
    expect(grandfatherCheck(initialGrandfatherDraft()).canPreview).toBe(false);
  });

  it('needs a valid length and a note of 5 to 300 characters', () => {
    expect(grandfatherCheck(ok).canPreview).toBe(true);
    expect(grandfatherCheck({ ...ok, months: '0' })).toMatchObject({
      months: false,
      canPreview: false,
    });
    expect(grandfatherCheck({ ...ok, months: '37' }).canPreview).toBe(false);
    expect(grandfatherCheck({ ...ok, note: 'abcd' }).note.tooShort).toBe(true);
    expect(grandfatherCheck({ ...ok, note: 'x'.repeat(301) }).note.tooLong).toBe(true);
    expect(grandfatherCheck({ ...ok, duration: 'open', months: 'junk' }).canPreview).toBe(true);
  });

  it('builds the dry run and the real run from the same draft', () => {
    expect(grandfatherPayload(ok, true)).toEqual({
      months: 6,
      note: 'Had it before it was paid',
      dryRun: true,
    });
    expect(grandfatherPayload({ ...ok, duration: 'open' }, false)).toEqual({
      months: null,
      note: 'Had it before it was paid',
      dryRun: false,
    });
  });

  it('every draft the check lets through is accepted by the contract and every one it refuses is not', () => {
    for (const duration of ['months', 'open'] as const)
      for (const months of ['', '0', '1', '36', '37'])
        for (const note of ['', 'abcd', 'abcde', 'x'.repeat(300), 'x'.repeat(301)])
          for (const dryRun of [true, false]) {
            const d: GrandfatherDraft = { duration, months, note };
            expect(grandfatherCheck(d).canPreview, JSON.stringify(d)).toBe(
              grandfatherSubscriptionsSchema.safeParse(grandfatherPayload(d, dryRun)).success,
            );
          }
  });
});

describe('grandfatherPreview', () => {
  const result = (over: Partial<MarketGrandfatherResult>): MarketGrandfatherResult => ({
    dryRun: true,
    matched: 2,
    comped: 0,
    sample: [
      { id: ID(50), name: 'Acme Retail' },
      { id: ID(51), name: 'Globex' },
    ],
    ...over,
  });

  it('lists the sample and offers the real run after a dry run that found someone', () => {
    expect(grandfatherPreview(result({}))).toEqual({
      matched: 2,
      shown: ['Acme Retail', 'Globex'],
      more: 0,
      canRun: true,
    });
  });

  it('says how many matched workspaces are beyond the sample', () => {
    expect(grandfatherPreview(result({ matched: 40 })).more).toBe(38);
  });

  it('offers nothing to run when nobody qualifies, and never after a real run', () => {
    expect(grandfatherPreview(result({ matched: 0, sample: [] })).canRun).toBe(false);
    expect(grandfatherPreview(result({ dryRun: false, comped: 2 })).canRun).toBe(false);
  });
});
