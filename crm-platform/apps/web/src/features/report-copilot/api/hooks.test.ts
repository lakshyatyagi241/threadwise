import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMutation, documentsQuery, reportDocumentsKey, uploadMutation } from './hooks';

const DOC = {
  id: '6b1b4a52-0d11-4cf6-9e0a-2d9f6b8a1c01',
  name: 'plan.pdf',
  extension: 'pdf',
  mime: 'application/pdf',
  sizeBytes: 1200,
  charCount: 800,
  truncated: false,
  status: 'ready',
  failureReason: null,
  createdAt: '2026-10-08T10:00:00.000Z',
};
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let qc: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('library hooks wiring', () => {
  it('keys the library per scope, so the two libraries never share a cache entry', () => {
    expect(reportDocumentsKey('workspace')).not.toEqual(reportDocumentsKey('platform'));
  });

  it('loads the library into the cache under its key', async () => {
    fetchMock.mockResolvedValue(ok({ data: [DOC], limit: 25 }));
    await qc.fetchQuery(documentsQuery('workspace'));
    expect(qc.getQueryData(reportDocumentsKey('workspace'))).toMatchObject({ limit: 25 });
    expect(qc.getQueryData(reportDocumentsKey('platform'))).toBeUndefined();
  });

  it('marks the library stale after an upload, and after a failed one too', async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: [], limit: 25 }));
    await qc.fetchQuery(documentsQuery('workspace'));
    expect(qc.getQueryState(reportDocumentsKey('workspace'))?.isInvalidated).toBe(false);

    fetchMock.mockResolvedValueOnce(ok(DOC, 201));
    const file = new File(['x'], 'a.txt');
    await qc.getMutationCache().build(qc, uploadMutation('workspace', qc)).execute(file);
    expect(qc.getQueryState(reportDocumentsKey('workspace'))?.isInvalidated).toBe(true);

    fetchMock.mockResolvedValueOnce(ok({ data: [DOC], limit: 25 }));
    await qc.fetchQuery({ ...documentsQuery('workspace'), staleTime: 0 });
    expect(qc.getQueryState(reportDocumentsKey('workspace'))?.isInvalidated).toBe(false);
    fetchMock.mockResolvedValueOnce(ok({ title: 'Unprocessable', status: 422, code: 'X' }, 422));
    await expect(
      qc.getMutationCache().build(qc, uploadMutation('workspace', qc)).execute(file),
    ).rejects.toThrow();
    expect(qc.getQueryState(reportDocumentsKey('workspace'))?.isInvalidated).toBe(true);
  });

  it('marks the library stale after a delete', async () => {
    fetchMock.mockResolvedValueOnce(ok({ data: [DOC], limit: 25 }));
    await qc.fetchQuery(documentsQuery('platform'));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await qc.getMutationCache().build(qc, deleteMutation('platform', qc)).execute(DOC.id);
    expect(qc.getQueryState(reportDocumentsKey('platform'))?.isInvalidated).toBe(true);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
      `/api/platform/report-copilot/documents/${DOC.id}`,
    );
  });
});
