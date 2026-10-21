import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  can,
  deliveryRate,
  pageCount,
  parseState,
  stateToQuery,
  stateToSearch,
} from './list-model';

describe('parseState and stateToSearch', () => {
  it('reads the filters from the address and falls back on a bad value', () => {
    const s = parseState(
      new URLSearchParams('status=running&type=template&range=30d&q= promo &page=3'),
    );
    expect(s).toEqual({
      status: 'running',
      type: 'template',
      range: '30d',
      from: '',
      to: '',
      q: 'promo',
      page: 3,
    });
    expect(parseState(new URLSearchParams('status=nope&type=x&range=1y&page=-2'))).toEqual(
      DEFAULT_STATE,
    );
    expect(parseState(new URLSearchParams('page=2.5')).page).toBe(1);
  });

  it('writes only what differs from the default', () => {
    expect(stateToSearch(DEFAULT_STATE)).toBe('');
    expect(stateToSearch({ ...DEFAULT_STATE, status: 'failed', page: 2 })).toBe(
      '?status=failed&page=2',
    );
    const s = {
      status: 'scheduled',
      type: 'flow',
      range: '7d',
      from: '',
      to: '',
      q: 'a b',
      page: 1,
    } as const;
    expect(parseState(new URLSearchParams(stateToSearch(s)))).toEqual(s);
  });
});

describe('the custom date range', () => {
  it('reads and writes the two days, both optional, only for range=custom', () => {
    expect(
      parseState(new URLSearchParams('range=custom&from=2026-10-01&to=2026-10-19')),
    ).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-19',
    });
    expect(
      stateToSearch({ ...DEFAULT_STATE, range: 'custom', from: '2026-10-01', to: '2026-10-19' }),
    ).toBe('?range=custom&from=2026-10-01&to=2026-10-19');
    expect(stateToSearch({ ...DEFAULT_STATE, range: 'custom', from: '2026-10-01', to: '' })).toBe(
      '?range=custom&from=2026-10-01',
    );
  });

  it('drops days that are not real days, and days outside the custom range', () => {
    expect(parseState(new URLSearchParams('range=custom&from=2026-02-31&to=soon'))).toMatchObject({
      from: '',
      to: '',
    });
    expect(parseState(new URLSearchParams('range=7d&from=2026-10-01&to=2026-10-19'))).toMatchObject(
      {
        range: '7d',
        from: '',
        to: '',
      },
    );
    expect(
      stateToSearch({ ...DEFAULT_STATE, range: '30d', from: '2026-10-01', to: '2026-10-19' }),
    ).toBe('?range=30d');
  });

  it('sends the days in the query only for range=custom, and leaves an open side out', () => {
    expect(stateToQuery({ ...DEFAULT_STATE, range: 'custom', from: '2026-10-01' })).toMatchObject({
      range: 'custom',
      from: '2026-10-01',
      to: '',
    });
    expect(
      stateToQuery({ ...DEFAULT_STATE, range: '7d', from: '2026-10-01', to: '2026-10-19' }),
    ).toMatchObject({
      from: '',
      to: '',
    });
  });
});

describe('what each status allows', () => {
  it('cancel on the live ones, resume on the stopped ones, edit before it runs, resend after', () => {
    expect(['running', 'scheduled'].map((s) => can.cancel(s as never))).toEqual([true, true]);
    expect(can.cancel('paused')).toBe(false);
    expect(['paused', 'failed', 'cancelled'].every((s) => can.resume(s as never))).toBe(true);
    expect(can.resume('running')).toBe(false);
    expect(['draft', 'scheduled', 'paused'].every((s) => can.edit(s as never))).toBe(true);
    expect(can.edit('running')).toBe(false);
    expect(['completed', 'failed', 'cancelled'].every((s) => can.resend(s as never))).toBe(true);
    // Edit and resend never both show.
    for (const s of [
      'draft',
      'scheduled',
      'running',
      'paused',
      'completed',
      'failed',
      'cancelled',
    ] as const) {
      expect(can.edit(s) && can.resend(s)).toBe(false);
    }
  });
});

describe('numbers', () => {
  it('delivery rate is delivered of sent, and 0 for nothing sent', () => {
    expect(
      deliveryRate({
        recipients: 10,
        sent: 3,
        delivered: 2,
        read: 0,
        replies: 0,
        clicks: 0,
        failed: 0,
      }),
    ).toBe(66.7);
    expect(
      deliveryRate({
        recipients: 10,
        sent: 0,
        delivered: 0,
        read: 0,
        replies: 0,
        clicks: 0,
        failed: 0,
      }),
    ).toBe(0);
    expect(pageCount(0, 12)).toBe(1);
    expect(pageCount(25, 12)).toBe(3);
  });
});
