import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft, buildCreateBody } from './lib/draft';
import { ID, SECRET_PATH, SECRET_TOKEN, source } from './test-fixtures';

const apiFetch = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import {
  createSource,
  fetchEvent,
  fetchEvents,
  fetchAttribution,
  previewMapping,
  retryEvent,
  rotateToken,
  sendTestLead,
  updateSource,
  deleteSource,
  fetchSource,
  fetchSources,
} from './api';

/**
 * The calls themselves, with the HTTP client replaced by a recorder: the right path, method and body, the contract schema at the
 * boundary, and the one-time token split off the source so it can live in component state and never in the query cache.
 */

beforeEach(() => apiFetch.mockReset());

describe('secrets are split off the source', () => {
  it('createSource returns the source without a token and the token on its own', async () => {
    apiFetch.mockResolvedValueOnce({ ...source(), token: SECRET_TOKEN, hookPath: SECRET_PATH });
    const res = await createSource(buildCreateBody({ ...emptyDraft(), name: 'Zapier' }));
    expect(res.secrets).toEqual({ token: SECRET_TOKEN, hookPath: SECRET_PATH });
    expect(Object.keys(res.source)).not.toContain('token');
    expect(Object.keys(res.source)).not.toContain('hookPath');
    expect(JSON.stringify(res.source)).not.toContain(SECRET_TOKEN);
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe('/lead-sources');
    expect(req.method).toBe('POST');
    expect(req.body.kind).toBe('webhook');
    expect(req.schema).toBeDefined();
  });

  it('rotateToken does the same for the new token', async () => {
    apiFetch.mockResolvedValueOnce({ ...source(), token: SECRET_TOKEN, hookPath: SECRET_PATH });
    const res = await rotateToken(ID(1));
    expect(res.secrets.token).toBe(SECRET_TOKEN);
    expect(JSON.stringify(res.source)).not.toContain(SECRET_TOKEN);
    expect(apiFetch.mock.calls[0]![0]).toBe(`/lead-sources/${ID(1)}/rotate-token`);
    expect(apiFetch.mock.calls[0]![1].method).toBe('POST');
  });
});

describe('requests', () => {
  it('lists the sources and unwraps the data', async () => {
    apiFetch.mockResolvedValueOnce({ data: [source()] });
    expect(await fetchSources()).toHaveLength(1);
    expect(apiFetch.mock.calls[0]![0]).toBe('/lead-sources');
  });

  it('reads and updates one source, the update carrying the row version it was given', async () => {
    apiFetch.mockResolvedValue(source());
    await fetchSource(ID(1));
    expect(apiFetch.mock.calls[0]![0]).toBe(`/lead-sources/${ID(1)}`);
    await updateSource(ID(1), { rowVersion: 4, status: 'paused' });
    const [path, req] = apiFetch.mock.calls[1]!;
    expect(path).toBe(`/lead-sources/${ID(1)}`);
    expect(req).toMatchObject({ method: 'PATCH', body: { rowVersion: 4, status: 'paused' } });
  });

  it('deletes with DELETE and expects no body', async () => {
    apiFetch.mockResolvedValueOnce(undefined);
    await deleteSource(ID(1));
    expect(apiFetch.mock.calls[0]).toEqual([`/lead-sources/${ID(1)}`, { method: 'DELETE' }]);
  });

  it('previews a draft mapping without writing: a POST to mapping-preview with the abort signal', async () => {
    apiFetch.mockResolvedValueOnce({});
    const ctrl = new AbortController();
    await previewMapping(ID(1), { mapping: {} } as never, ctrl.signal).catch(() => undefined);
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe(`/lead-sources/${ID(1)}/mapping-preview`);
    expect(req.method).toBe('POST');
    expect(req.signal).toBe(ctrl.signal);
  });

  it('sends a test lead: a sample when no payload is given, the posted payload otherwise', async () => {
    apiFetch.mockResolvedValue({});
    await sendTestLead(ID(1));
    expect(apiFetch.mock.calls[0]![1].body).toEqual({});
    await sendTestLead(ID(1), { name: 'A' });
    expect(apiFetch.mock.calls[1]![1].body).toEqual({ payload: { name: 'A' } });
    expect(apiFetch.mock.calls[1]![0]).toBe(`/lead-sources/${ID(1)}/test`);
  });

  it('lists events with the filters and the cursor, and opens one event on its own route', async () => {
    apiFetch.mockResolvedValue({});
    await fetchEvents(ID(1), { status: 'failed', isTest: 'false', cursor: 'c1' });
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe(`/lead-sources/${ID(1)}/events`);
    expect(req.query).toEqual({ limit: 25, status: 'failed', isTest: 'false', cursor: 'c1' });
    await fetchEvent(ID(1), ID(2));
    expect(apiFetch.mock.calls[1]![0]).toBe(`/lead-sources/${ID(1)}/events/${ID(2)}`);
  });

  it('retries an event with a POST', async () => {
    apiFetch.mockResolvedValue({});
    await retryEvent(ID(1), ID(2));
    const [path, req] = apiFetch.mock.calls[0]!;
    expect(path).toBe(`/lead-sources/${ID(1)}/events/${ID(2)}/retry`);
    expect(req.method).toBe('POST');
  });

  it("reads a contact's attribution from the contact's own route", async () => {
    apiFetch.mockResolvedValue({});
    await fetchAttribution(ID(7));
    expect(apiFetch.mock.calls[0]![0]).toBe(`/contacts/${ID(7)}/attribution`);
  });
});
