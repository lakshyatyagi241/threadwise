import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { reportCopilotApi, runtimeUrl } from './service';

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

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
};

describe('runtimeUrl', () => {
  it('goes through the staff proxy for a workspace and the operator proxy for the platform', () => {
    expect(runtimeUrl('workspace')).toBe('/api/v2/report-copilot/runtime');
    expect(runtimeUrl('platform')).toBe('/api/platform/report-copilot/runtime');
  });
});

describe('reportCopilotApi.list', () => {
  it('reads the workspace library and parses it with the contract', async () => {
    fetchMock.mockResolvedValue(json({ data: [DOC], limit: 25 }));
    const out = await reportCopilotApi.list('workspace');
    expect(out.data[0]?.name).toBe('plan.pdf');
    const { url, init } = lastCall();
    expect(url).toBe('/api/v2/report-copilot/documents');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
  });

  it('reads the platform library through the operator proxy', async () => {
    fetchMock.mockResolvedValue(json({ data: [], limit: 25 }));
    await reportCopilotApi.list('platform');
    expect(lastCall().url).toBe('/api/platform/report-copilot/documents');
  });

  it('refuses an answer that is not the contract (a server of another version)', async () => {
    fetchMock.mockResolvedValue(json({ data: [{ id: 'nope' }], limit: 25 }));
    await expect(reportCopilotApi.list('workspace')).rejects.toThrow();
  });
});

describe('reportCopilotApi.upload', () => {
  const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

  it('posts multipart with the file, lets the browser set the boundary and sends an idempotency key', async () => {
    fetchMock.mockResolvedValue(json(DOC, 201));
    const out = await reportCopilotApi.upload('workspace', file);
    expect(out.id).toBe(DOC.id);
    const { url, init, headers } = lastCall();
    expect(url).toBe('/api/v2/report-copilot/documents');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('file')).toBeInstanceOf(File);
    expect(headers.get('content-type')).toBeNull();
    expect(headers.get('idempotency-key')).toBeTruthy();
    expect(headers.get('x-request-id')).toBeTruthy();
  });

  it('adds the display name when given', async () => {
    fetchMock.mockResolvedValue(json(DOC, 201));
    await reportCopilotApi.upload('platform', file, 'Board pack');
    const { url, init } = lastCall();
    expect(url).toBe('/api/platform/report-copilot/documents');
    expect((init.body as FormData).get('name')).toBe('Board pack');
  });

  it('turns problem+json into an ApiError that carries the stable code', async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          type: 'about:blank',
          title: 'Unprocessable',
          status: 422,
          code: ERROR_CODES.REPORT_DOC_NO_TEXT,
          detail: 'No readable text found.',
        },
        422,
        'application/problem+json',
      ),
    );
    const err = await reportCopilotApi.upload('workspace', file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(422);
    expect((err as ApiError).code).toBe(ERROR_CODES.REPORT_DOC_NO_TEXT);
    expect((err as ApiError).message).toBe('No readable text found.');
  });

  it('survives a body that is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    const err = await reportCopilotApi.upload('platform', file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
  });
});

describe('reportCopilotApi.remove', () => {
  it('deletes by id on the right proxy and accepts the empty 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(reportCopilotApi.remove('workspace', DOC.id)).resolves.toBeUndefined();
    expect(lastCall().url).toBe(`/api/v2/report-copilot/documents/${DOC.id}`);
    expect(lastCall().init.method).toBe('DELETE');
    expect(lastCall().headers.get('idempotency-key')).toBeTruthy();

    await reportCopilotApi.remove('platform', DOC.id);
    expect(lastCall().url).toBe(`/api/platform/report-copilot/documents/${DOC.id}`);
  });
});
