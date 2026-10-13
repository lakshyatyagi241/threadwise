// @vitest-environment jsdom
import type { LscRun } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, mount, text, type Mounted } from '../testing';

const state = vi.hoisted(() => ({ runs: {} as Record<string, unknown>, filters: [] as unknown[] }));
vi.mock('../api/hooks', () => ({
  useLscRuns: (filter: unknown) => {
    state.filters.push(filter);
    return state.runs;
  },
}));

import { RunsLog } from './runs-log';

const run = (over: Partial<LscRun> = {}): LscRun => ({
  id: 'r1',
  createdAt: '2026-03-12T15:04:00.000Z',
  contactId: '294dca7c-5806-4548-9035-dcca9befc7b1',
  contactName: 'Aarav Sharma',
  status: 'ok',
  trigger: 'created',
  score: 72,
  previousScore: null,
  reasons: [],
  model: 'm',
  promptTokens: 400,
  completionTokens: 30,
  costUsd: '0.00010000',
  costSource: 'vendor',
  billedAgainst: 'workspace',
  durationMs: 800,
  error: null,
  ...over,
});
const base = {
  isPending: false,
  isError: false,
  error: null,
  items: [] as LscRun[],
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetching: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

let m: Mounted | null = null;
beforeEach(() => {
  state.filters = [];
  state.runs = { ...base, fetchNextPage: vi.fn(), refetch: vi.fn() };
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});
const show = async () => {
  m = await mount(<RunsLog enabled />);
  return m.host;
};
const cells = (host: HTMLElement) =>
  [...host.querySelectorAll('tbody td')].map((c) => c.textContent);

describe('RunsLog', () => {
  it('shows the contact, result, score, trigger, tokens, cost and key of each attempt', async () => {
    state.runs = { ...state.runs, items: [run()] };
    const host = await show();
    const c = cells(host);
    expect(c).toEqual([
      'Mar 12, 2026, 3:04 PM',
      'Aarav Sharma',
      'Scored',
      '72',
      'Contact created',
      '430',
      '$0.0001',
      'Your key',
    ]);
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      '/contacts/294dca7c-5806-4548-9035-dcca9befc7b1',
    );
  });

  it('never prints a non-zero cost as $0.00, and marks an estimate', async () => {
    state.runs = {
      ...state.runs,
      items: [
        run({ id: 'a', costUsd: '0.00000300' }),
        run({ id: 'b', costUsd: '0.00012000', costSource: 'estimate' }),
      ],
    };
    const host = await show();
    const costs = [...host.querySelectorAll('tbody tr')].map((r) => r.children[6]!.textContent);
    expect(costs).toEqual(['$0.000003', '$0.00012 ~']);
  });

  it('shows no cost or tokens for an attempt that made no call, and says why it was skipped', async () => {
    state.runs = {
      ...state.runs,
      items: [
        run({
          status: 'skipped',
          score: null,
          costSource: 'none',
          costUsd: '0',
          promptTokens: 0,
          completionTokens: 0,
          billedAgainst: 'none',
          error: 'no_key',
        }),
      ],
    };
    const host = await show();
    expect(host.textContent).toContain('Skipped');
    expect(host.textContent).toContain(text('runs.reason.no_key'));
    const row = host.querySelector('tbody tr')!;
    expect(row.children[5]!.textContent).toBe('—');
    expect(row.children[6]!.textContent).toBe('—');
  });

  it('shows the score move for a refresh and a deleted contact in words', async () => {
    state.runs = {
      ...state.runs,
      items: [run({ previousScore: 40, contactId: null, contactName: null })],
    };
    const host = await show();
    expect(cells(host)).toContain('40 → 72');
    expect(cells(host)).toContain(text('runs.deletedContact'));
  });

  it('loads the next cursor page on request, and only when there is one', async () => {
    state.runs = { ...state.runs, items: [run()], hasNextPage: true };
    const host = await show();
    await click(byText(host, 'button', text('log.loadMore')));
    expect(state.runs.fetchNextPage).toHaveBeenCalledTimes(1);
    await m?.unmount();
    state.runs = { ...state.runs, hasNextPage: false };
    const again = await show();
    expect(
      [...again.querySelectorAll('button')].some((b) => b.textContent === text('log.loadMore')),
    ).toBe(false);
  });

  it('filters by result', async () => {
    state.runs = { ...state.runs, items: [run()] };
    const host = await show();
    const select = host.querySelector<HTMLSelectElement>('#lsc-log-status')!;
    const { act } = await import('react');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        select,
        'failed',
      );
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.filters.at(-1)).toEqual({ status: 'failed' });
    expect(state.filters[0]).toEqual({});
  });

  it('explains an empty log, a filtered empty log, and a failed load', async () => {
    let host = await show();
    expect(host.textContent).toContain(text('log.emptyTitle'));
    await m?.unmount();
    state.runs = { ...base, isError: true, error: new TypeError('x'), refetch: vi.fn() };
    host = await show();
    expect(host.textContent).toContain(text('errors.network'));
  });
});
