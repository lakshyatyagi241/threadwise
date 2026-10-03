import { describe, expect, it } from 'vitest';
import { isOutsideBusinessHours } from '../../../src/modules/flow-runtime-engine/triggers/business-hours';
import {
  isCatchAll,
  matchKeywordFlow,
  type KeywordFlow,
} from '../../../src/modules/flow-runtime-engine/triggers/keyword-match';

const f = (id: number, keywords: string, channelId: number | null = null): KeywordFlow => ({
  id,
  keywords,
  channelId,
});

describe('keyword flows', () => {
  it('contains, case-insensitive, any of the comma keywords', () => {
    expect(matchKeywordFlow([f(1, 'book, appointment')], 'I want to BOOK a slot', 1)?.id).toBe(1);
    expect(matchKeywordFlow([f(1, 'book, appointment')], 'hello', 1)).toBeNull();
    expect(matchKeywordFlow([f(1, 'hi')], '   ', 1)).toBeNull();
  });

  it('a default route never outranks a keyword flow, and fires when nothing matched', () => {
    const flows = [f(1, 'any'), f(2, 'book')];
    expect(matchKeywordFlow(flows, 'book now', 1)?.id).toBe(2);
    expect(matchKeywordFlow(flows, 'anything else', 1)?.id).toBe(1);
  });

  it('the flow bound to the channel wins, then the lowest id; a flow bound elsewhere never fires', () => {
    expect(matchKeywordFlow([f(1, 'hi'), f(2, 'hi', 7)], 'hi', 7)?.id).toBe(2);
    expect(matchKeywordFlow([f(3, 'hi'), f(2, 'hi')], 'hi', 7)?.id).toBe(2);
    expect(matchKeywordFlow([f(1, 'hi', 9)], 'hi', 7)).toBeNull();
  });

  it('knows the catch-all spellings, exactly', () => {
    for (const k of ['*', '.*', '.+', 'any', '  any ']) expect(isCatchAll(k)).toBe(true);
    for (const k of ['ANY', 'anything', 'any,hi']) expect(isCatchAll(k)).toBe(false);
  });
});

describe('business hours', () => {
  const hours = JSON.stringify({
    days: { mon: { enabled: true, from: '09:00', to: '17:00' }, tue: { enabled: false } },
  });
  const at = (iso: string) => new Date(iso);

  it('no config is always open', () => {
    expect(isOutsideBusinessHours(null, 'UTC', at('2026-10-05T03:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours('{"days":{}}', 'UTC', at('2026-10-05T03:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours('not json', 'UTC', at('2026-10-05T03:00:00Z'))).toBe(false);
  });

  it('inside, before, after and a closed day', () => {
    expect(isOutsideBusinessHours(hours, 'UTC', at('2026-10-05T10:00:00Z'))).toBe(false); // Monday
    expect(isOutsideBusinessHours(hours, 'UTC', at('2026-10-05T18:00:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(hours, 'UTC', at('2026-10-05T08:59:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(hours, 'UTC', at('2026-10-06T10:00:00Z'))).toBe(true); // Tuesday off
    expect(isOutsideBusinessHours(hours, 'UTC', at('2026-10-07T10:00:00Z'))).toBe(true); // Wednesday missing
  });

  it('reads the clock in the workspace time zone', () => {
    // 10:00 UTC on Monday is 15:30 in Kolkata (open) but 03:00 in Los Angeles (closed).
    expect(isOutsideBusinessHours(hours, 'Asia/Kolkata', at('2026-10-05T10:00:00Z'))).toBe(false);
    expect(isOutsideBusinessHours(hours, 'America/Los_Angeles', at('2026-10-05T10:00:00Z'))).toBe(
      true,
    );
  });

  it('handles an overnight shift', () => {
    const night = JSON.stringify({ days: { mon: { enabled: true, from: '22:00', to: '06:00' } } });
    expect(isOutsideBusinessHours(night, 'UTC', at('2026-10-05T23:00:00Z'))).toBe(false); // Monday night
    expect(isOutsideBusinessHours(night, 'UTC', at('2026-10-06T05:00:00Z'))).toBe(false); // Tuesday small hours
    expect(isOutsideBusinessHours(night, 'UTC', at('2026-10-06T07:00:00Z'))).toBe(true);
    expect(isOutsideBusinessHours(night, 'UTC', at('2026-10-05T12:00:00Z'))).toBe(true);
  });
});
