import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID } from './test-fixtures';

const apiFetch = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import {
  connectMetaForm,
  disableMetaPage,
  disconnectMetaForm,
  enableMetaPage,
  fetchMetaForms,
  fetchMetaHealth,
  fetchMetaOverview,
  startMetaLogin,
} from './meta-api';

/**
 * The Meta calls with the HTTP client replaced by a recorder: the right path and method, the contract schema at the boundary, and
 * the abort signal where a screen can leave before the answer comes back.
 */

beforeEach(() => apiFetch.mockReset());

describe('Meta lead forms requests', () => {
  it('reads the overview', async () => {
    apiFetch.mockResolvedValue({});
    const ctrl = new AbortController();
    await fetchMetaOverview(ctrl.signal);
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe('/meta-lead-ads');
    expect(req.schema).toBeDefined();
    expect(req.signal).toBe(ctrl.signal);
    expect(req.method).toBeUndefined();
  });

  it('starts the Facebook login with a POST and no body', async () => {
    apiFetch.mockResolvedValue({ url: 'https://www.facebook.com/dialog/oauth' });
    await startMetaLogin();
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe('/meta-lead-ads/connect/start');
    expect(req.method).toBe('POST');
    expect(req.body).toBeUndefined();
    expect(req.schema).toBeDefined();
  });

  it('turns lead sync on and off for a Page by its uuid', async () => {
    apiFetch.mockResolvedValue({});
    await enableMetaPage(ID(500));
    await disableMetaPage(ID(500));
    expect(apiFetch.mock.calls[0]![0]).toBe(`/meta-lead-ads/pages/${ID(500)}/enable`);
    expect(apiFetch.mock.calls[0]![1].method).toBe('POST');
    expect(apiFetch.mock.calls[1]![0]).toBe(`/meta-lead-ads/pages/${ID(500)}/disable`);
    expect(apiFetch.mock.calls[1]![1].method).toBe('POST');
  });

  it("lists a Page's forms, picks one and stops one", async () => {
    apiFetch.mockResolvedValue({});
    await fetchMetaForms(ID(500));
    await connectMetaForm(ID(500), '9900110022');
    await disconnectMetaForm(ID(500), '9900110022');
    expect(apiFetch.mock.calls[0]![0]).toBe(`/meta-lead-ads/pages/${ID(500)}/forms`);
    expect(apiFetch.mock.calls[1]![0]).toBe(
      `/meta-lead-ads/pages/${ID(500)}/forms/9900110022/connect`,
    );
    expect(apiFetch.mock.calls[1]![1].method).toBe('POST');
    // stopping answers 204: no schema to parse
    expect(apiFetch.mock.calls[2]).toEqual([
      `/meta-lead-ads/pages/${ID(500)}/forms/9900110022`,
      { method: 'DELETE' },
    ]);
  });

  it('puts only encoded segments in a path', async () => {
    apiFetch.mockResolvedValue({});
    await connectMetaForm(ID(500), '1/../2');
    await fetchMetaHealth('a b');
    expect(apiFetch.mock.calls[0]![0]).toContain('1%2F..%2F2');
    expect(apiFetch.mock.calls[1]![0]).toBe('/meta-lead-ads/sources/a%20b/health');
  });

  it("reads one form source's health", async () => {
    apiFetch.mockResolvedValue({});
    await fetchMetaHealth(ID(7));
    expect(apiFetch.mock.calls[0]![0]).toBe(`/meta-lead-ads/sources/${ID(7)}/health`);
  });
});
