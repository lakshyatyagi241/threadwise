import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('@/lib/api/client', () => ({ apiFetch }));

import { faqApi } from './service';

const FLOW = '00000000-0000-4000-8000-0000000000aa';
const E = '11111111-2222-4333-8444-555555555555';
const V = '66666666-7777-4888-8999-000000000000';
const base = `/faq/flows/${FLOW}`;

const last = () => apiFetch.mock.calls.at(-1) as unknown as [string, Record<string, unknown>];

describe('the FAQ client is scoped by flow', () => {
  beforeEach(() => apiFetch.mockClear());

  it('reads and writes entries under the flow', async () => {
    await faqApi.list(FLOW, { limit: 1 });
    expect(last()[0]).toBe(`${base}/entries`);
    expect(last()[1].query).toEqual({ limit: 1 });
    await faqApi.get(FLOW, E);
    expect(last()[0]).toBe(`${base}/entries/${E}`);
    await faqApi.create(FLOW, {} as never);
    expect(last()[0]).toBe(`${base}/entries`);
    expect(last()[1].method).toBe('POST');
    await faqApi.update(FLOW, E, {} as never);
    expect([last()[0], last()[1].method]).toEqual([`${base}/entries/${E}`, 'PATCH']);
    await faqApi.remove(FLOW, E);
    expect([last()[0], last()[1].method]).toEqual([`${base}/entries/${E}`, 'DELETE']);
    await faqApi.bulk(FLOW, {} as never);
    expect(last()[0]).toBe(`${base}/entries/bulk`);
  });

  it('scopes variations, test, insights and settings', async () => {
    await faqApi.addVariations(FLOW, E, {} as never);
    expect(last()[0]).toBe(`${base}/entries/${E}/variations`);
    await faqApi.generate(FLOW, E, {} as never);
    expect(last()[0]).toBe(`${base}/entries/${E}/variations/generate`);
    await faqApi.updateVariation(FLOW, E, V, {} as never);
    expect([last()[0], last()[1].method]).toEqual([
      `${base}/entries/${E}/variations/${V}`,
      'PATCH',
    ]);
    await faqApi.removeVariation(FLOW, E, V);
    expect(last()[1].method).toBe('DELETE');
    await faqApi.test(FLOW, 'hello');
    expect([last()[0], last()[1].body]).toEqual([`${base}/test`, { query: 'hello' }]);
    await faqApi.summary(FLOW, 30);
    expect([last()[0], last()[1].query]).toEqual([`${base}/insights/summary`, { days: 30 }]);
    await faqApi.log(FLOW, { view: 'all' });
    expect(last()[0]).toBe(`${base}/insights/log`);
    await faqApi.learn(FLOW, E, { faqId: V });
    expect(last()[0]).toBe(`${base}/insights/log/${E}/learn`);
    await faqApi.dismiss(FLOW, E);
    expect(last()[0]).toBe(`${base}/insights/log/${E}/dismiss`);
    await faqApi.settings(FLOW);
    expect(last()[0]).toBe(`${base}/settings`);
    await faqApi.saveSettings(FLOW, {} as never);
    expect([last()[0], last()[1].method]).toEqual([`${base}/settings`, 'PUT']);
  });

  it('lists the steps of the answer target (any flow) under flow-nodes', async () => {
    await faqApi.flowNodes(E);
    expect(last()[0]).toBe(`/faq/flow-nodes/${E}`);
  });

  it('never calls the removed workspace routes', async () => {
    await faqApi.list(FLOW, {});
    await faqApi.settings(FLOW);
    await faqApi.test(FLOW, 'x');
    for (const [path] of apiFetch.mock.calls as unknown as [string][])
      expect(path.startsWith('/faq/flows/')).toBe(true);
  });
});
