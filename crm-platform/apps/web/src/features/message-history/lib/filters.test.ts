import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE,
  exportBody,
  feedQuery,
  insightsQuery,
  isNarrowed,
  parseState,
  rangeDays,
  stateToSearch,
  summaryQuery,
} from './filters';

const U = '0b6f6c2e-7a3d-4a0e-9c1e-2f6f6d9a1b11';
const parse = (qs: string) => parseState(new URLSearchParams(qs));

describe('the address of the screen', () => {
  it('an empty address is the default state: the last 30 days, everything', () => {
    expect(parse('')).toEqual(EMPTY_STATE);
    expect(stateToSearch(EMPTY_STATE)).toBe('');
  });

  it('round-trips every filter', () => {
    const s = {
      ...EMPTY_STATE,
      range: '7d' as const,
      dir: 'fail' as const,
      type: 'template' as const,
      source: ['flow' as const, 'api' as const],
      status: 'failed' as const,
      channelId: U,
      templateId: U,
      campaignId: U,
      q: 'asha',
      bucket: 'weekly' as const,
      open: `m:${U}`,
    };
    expect(parse(stateToSearch(s))).toEqual(s);
  });

  it('a custom window wins over a preset and needs both days', () => {
    const s = parse('range=7d&from=2026-10-01&to=2026-10-03');
    expect(s).toMatchObject({ from: '2026-10-01', to: '2026-10-03' });
    expect(stateToSearch(s)).toBe('?from=2026-10-01&to=2026-10-03');
    expect(parse('from=2026-10-01')).toMatchObject({ from: '', to: '', range: '30d' });
    expect(parse('from=nope&to=2026-10-03')).toMatchObject({ from: '', to: '' });
  });

  it('drops what it does not know, so a stale link still opens', () => {
    const s = parse(
      `range=yesterday&dir=sideways&type=fax&status=lost&source=flow,nope,flow&channelId=x&open=bad&bucket=yearly`,
    );
    expect(s).toEqual({ ...EMPTY_STATE, source: ['flow'] });
  });

  it('cuts a search to 100 characters and trims it', () => {
    expect(parse(`q=${'x'.repeat(300)}`).q).toHaveLength(100);
    expect(parse('q=%20%20hello%20').q).toBe('hello');
  });
});

describe('the API queries', () => {
  const s = {
    ...EMPTY_STATE,
    dir: 'out' as const,
    source: ['flow' as const, 'ai' as const],
    status: 'failed' as const,
    campaignId: U,
    q: 'x',
    bucket: 'hourly' as const,
  };

  it('the feed takes every filter and omits the empty ones', () => {
    expect(feedQuery(s)).toEqual({
      range: '30d',
      campaignId: U,
      dir: 'out',
      source: 'flow,ai',
      status: 'failed',
      q: 'x',
      channelId: undefined,
      templateId: undefined,
      broadcastId: undefined,
      scheduledId: undefined,
      type: undefined,
    });
  });

  it('the cards take the window and the scoping filters only', () => {
    const q = summaryQuery(s);
    expect(q).toMatchObject({ range: '30d', campaignId: U });
    for (const k of ['dir', 'type', 'source', 'status', 'q']) expect(q).not.toHaveProperty(k);
  });

  it('the charts take every filter, the bucket and the zone', () => {
    expect(insightsQuery(s, 'Asia/Kolkata')).toMatchObject({
      dir: 'out',
      bucket: 'hourly',
      tz: 'Asia/Kolkata',
    });
  });

  it('an export sends the filters as the API reads them, sources as a list', () => {
    expect(exportBody(s)).toEqual({
      range: '30d',
      campaignId: U,
      dir: 'out',
      source: ['flow', 'ai'],
      status: 'failed',
      q: 'x',
    });
    expect(exportBody({ ...EMPTY_STATE, from: '2026-10-01', to: '2026-10-02' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-02',
    });
  });
});

describe('narrowing and the period', () => {
  it('knows whether anything narrows the feed', () => {
    expect(isNarrowed(EMPTY_STATE)).toBe(false);
    expect(isNarrowed({ ...EMPTY_STATE, range: '7d' })).toBe(false);
    expect(isNarrowed({ ...EMPTY_STATE, q: 'a' })).toBe(true);
    expect(isNarrowed({ ...EMPTY_STATE, broadcastId: U })).toBe(true);
    expect(isNarrowed({ ...EMPTY_STATE, dir: 'in' })).toBe(true);
  });

  it('counts the days of a preset and has none for custom dates', () => {
    expect(rangeDays({ ...EMPTY_STATE, range: '24h' })).toBe(1);
    expect(rangeDays({ ...EMPTY_STATE, range: '90d' })).toBe(90);
    expect(rangeDays({ ...EMPTY_STATE, from: '2026-10-01', to: '2026-10-02' })).toBeNull();
  });
});
