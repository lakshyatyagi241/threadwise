import { describe, expect, it } from 'vitest';
import {
  barHeights,
  durationText,
  forPlan,
  heatGrid,
  heatLevel,
  knownReason,
  knownStep,
  logSearch,
  pageCount,
  parseLogParams,
  percentText,
  phoneText,
  sourcesFor,
  toAnalyticsQuery,
  toListQuery,
  WHATSAPP_CALLING,
} from './call-logs';

const sp = (s: string) => new URLSearchParams(s);
const ID = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';

describe('the filters in the address', () => {
  it('has Reference’s defaults for a plain address: the last 30 days, page 1', () => {
    expect(parseLogParams(sp(''))).toEqual({
      range: '30d',
      from: undefined,
      to: undefined,
      status: undefined,
      direction: undefined,
      numberId: undefined,
      agentId: undefined,
      source: undefined,
      q: undefined,
      page: 1,
    });
  });

  it('reads how a call reached the log, keeps it in the address and sends it to the list and the analytics', () => {
    expect(parseLogParams(sp('source=mobile_app')).source).toBe('mobile_app');
    expect(parseLogParams(sp('source=whatsapp')).source).toBe('whatsapp');
    expect(parseLogParams(sp('source=carrier_pigeon')).source).toBeUndefined();
    const p = parseLogParams(sp('source=telephony&status=completed'));
    expect(logSearch(p)).toBe('?status=completed&source=telephony');
    expect(logSearch({ ...p, source: undefined })).toBe('?status=completed');
    expect(toListQuery(p, 'UTC').source).toBe('telephony');
    expect(toAnalyticsQuery(p, 'UTC').source).toBe('telephony');
  });

  it('reads every filter, and ignores what is not valid', () => {
    const p = parseLogParams(
      sp(
        `range=7d&status=no-answer&direction=outbound&numberId=${ID}&agentId=${ID}&q=%20priya%20&page=3&from=2026-10-01&to=2026-10-09`,
      ),
    );
    expect(p).toMatchObject({
      range: '7d',
      status: 'no-answer',
      direction: 'outbound',
      numberId: ID,
      agentId: ID,
      q: 'priya',
      page: 3,
      from: '2026-10-01',
      to: '2026-10-09',
    });
    const bad = parseLogParams(
      sp('range=99d&status=weird&direction=x&numberId=nope&agentId=1&page=-4&from=yesterday&q='),
    );
    expect(bad).toMatchObject({ range: '30d', page: 1 });
    expect(bad.status).toBeUndefined();
    expect(bad.numberId).toBeUndefined();
    expect(bad.from).toBeUndefined();
    expect(parseLogParams(sp('page=abc')).page).toBe(1);
    expect(parseLogParams(sp('page=1.5')).page).toBe(1);
  });

  it('writes an address that leaves out the defaults, and reads back what it wrote', () => {
    expect(logSearch({ range: '30d', page: 1 })).toBe('');
    expect(logSearch({ range: '24h' })).toBe('?range=24h');
    const full = {
      range: '7d' as const,
      status: 'failed' as const,
      direction: 'inbound' as const,
      numberId: ID,
      agentId: ID,
      q: 'a b',
      page: 2,
    };
    expect(parseLogParams(sp(logSearch(full)))).toMatchObject(full);
  });

  it('a custom range replaces the preset', () => {
    expect(logSearch({ range: '7d', from: '2026-10-01', to: '2026-10-05' })).toBe(
      '?from=2026-10-01&to=2026-10-05',
    );
    expect(
      toListQuery(parseLogParams(sp('range=7d&from=2026-10-01')), 'Asia/Kolkata'),
    ).toMatchObject({ range: undefined, from: '2026-10-01', tz: 'Asia/Kolkata' });
    expect(toListQuery(parseLogParams(sp('range=7d')), 'Asia/Kolkata')).toMatchObject({
      range: '7d',
      tz: undefined,
    });
  });

  it('the analytics always counts days in the person’s zone and ignores the log-only filters', () => {
    const q = toAnalyticsQuery(
      parseLogParams(sp(`range=7d&status=failed&numberId=${ID}`)),
      'Europe/Paris',
    );
    expect(q).toEqual({
      range: '7d',
      from: undefined,
      to: undefined,
      tz: 'Europe/Paris',
      numberId: ID,
    });
  });

  it('counts pages', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(100, 0)).toBe(100);
  });
});

describe('words and numbers', () => {
  it('shows a duration as M:SS, like Reference’s list', () => {
    expect(durationText(0)).toBe('0:00');
    expect(durationText(5)).toBe('0:05');
    expect(durationText(65)).toBe('1:05');
    expect(durationText(4503)).toBe('75:03');
    expect(durationText(-3)).toBe('0:00');
    expect(durationText(59.6)).toBe('1:00');
  });

  it('shows a phone number with a plus', () => {
    expect(phoneText('919811100001')).toBe('+919811100001');
    expect(phoneText('+91 98111-00001')).toBe('+919811100001');
    expect(phoneText(null)).toBe('');
  });

  it('knows the reasons and steps that have words', () => {
    expect(knownReason('no_permission')).toBe('NO_PERMISSION');
    expect(knownReason('NO_PERMISSION')).toBe('NO_PERMISSION');
    expect(knownReason('rejected')).toBe('REJECTED');
    expect(knownReason('SOMETHING_NEW')).toBeNull();
    expect(knownStep('terminate')).toBe('terminate');
    expect(knownStep('mystery')).toBeNull();
  });

  it('writes a share as a percent', () => {
    expect(percentText(0.6)).toBe('60%');
    expect(percentText(1.4)).toBe('100%');
    expect(percentText(-1)).toBe('0%');
  });
});

describe('what the analytics draws', () => {
  it('shades the heat map in four steps against the busiest cell', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(5, 0)).toBe(0);
  });

  it('lays the cells on a 7 x 24 grid and finds the busiest', () => {
    const { grid, max } = heatGrid([
      { weekday: 0, hour: 0, calls: 2 },
      { weekday: 6, hour: 23, calls: 7 },
      { weekday: 9, hour: 5, calls: 99 },
    ]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid[0]![0]).toBe(2);
    expect(grid[6]![23]).toBe(7);
    expect(max).toBe(7);
    expect(heatGrid([]).max).toBe(0);
  });

  it('draws bars against the tallest day, and nothing for an empty period', () => {
    expect(barHeights([1, 2, 4])).toEqual([0.25, 0.5, 1]);
    expect(barHeights([0, 0])).toEqual([0, 0]);
    expect(barHeights([])).toEqual([]);
  });
});

describe('a workspace without WhatsApp calling (BL-257)', () => {
  const stale = parseLogParams(sp(`numberId=${ID}&source=whatsapp&status=failed&agentId=${ID}`));

  it('names the plan feature the API gates the WhatsApp parts with', () => {
    expect(WHATSAPP_CALLING).toBe('waba_calling');
  });

  it('drops the WhatsApp number and the WhatsApp source from the address, and keeps the rest', () => {
    const p = forPlan(stale, false);
    expect(p.numberId).toBeUndefined();
    expect(p.source).toBeUndefined();
    expect(p.status).toBe('failed');
    expect(p.agentId).toBe(ID);
    expect(toListQuery(p, 'UTC')).toMatchObject({ numberId: undefined, source: undefined });
    expect(toAnalyticsQuery(p, 'UTC')).toMatchObject({ numberId: undefined, source: undefined });
  });

  it('keeps a source that is not WhatsApp’s', () => {
    expect(forPlan(parseLogParams(sp('source=telephony')), false).source).toBe('telephony');
  });

  it('changes nothing with WhatsApp calling', () => {
    expect(forPlan(stale, true)).toBe(stale);
  });

  it('offers the four ways a call is logged without it, and all five with it', () => {
    expect(sourcesFor(false)).toEqual(['manual', 'telephony', 'mobile_app', 'web_click_to_call']);
    expect([...sourcesFor(true)].sort()).toEqual(
      ['manual', 'mobile_app', 'telephony', 'web_click_to_call', 'whatsapp'].sort(),
    );
  });
});
