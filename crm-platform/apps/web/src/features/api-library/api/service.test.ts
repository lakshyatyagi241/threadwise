import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { apiLibraryApi } from './service';

const ID = '00000000-0000-4000-8000-000000000001';
const item = {
  id: ID,
  name: 'Orders',
  method: 'GET',
  url: 'https://a.test',
  payloadType: 'application/json',
  hasFunction: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  rowVersion: 1,
};

let calls: Array<{ url: string; init: RequestInit }> = [];
const reply = (status: number, body: unknown) =>
  vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('apiLibraryApi', () => {
  const numbered = (rows: unknown[], over: Record<string, unknown> = {}) => ({
    data: rows,
    page: {
      nextCursor: null,
      hasMore: true,
      limit: 25,
      page: 2,
      pageSize: 25,
      total: 53,
      totalPages: 3,
    },
    total: 53,
    pageSize: 25,
    totalPages: 3,
    ...over,
  });

  it('lists a numbered page with the search and method, and flattens the totals', async () => {
    vi.stubGlobal('fetch', reply(200, numbered([item])));
    const page = await apiLibraryApi.list({ page: 2, limit: 25, search: 'ord', method: 'POST' });
    expect(calls[0]!.url).toBe('/api/v2/api-library/apis?page=2&limit=25&search=ord&method=POST');
    expect(calls[0]!.url).not.toContain('cursor');
    expect(page.data[0]!.name).toBe('Orders');
    expect(page).toMatchObject({ total: 53, page: 2, pageSize: 25, totalPages: 3 });
  });

  it('reads totals that only sit inside the page object', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        data: [],
        page: {
          nextCursor: null,
          hasMore: false,
          limit: 10,
          page: 1,
          pageSize: 10,
          total: 0,
          totalPages: 1,
        },
      }),
    );
    const page = await apiLibraryApi.list({ page: 1, limit: 10 });
    expect(page).toMatchObject({ total: 0, totalPages: 1, pageSize: 10 });
  });

  it('leaves an empty search out of the query', async () => {
    vi.stubGlobal('fetch', reply(200, numbered([], { total: 0 })));
    await apiLibraryApi.list({ page: 1, limit: 25, search: '' });
    expect(calls[0]!.url).toBe('/api/v2/api-library/apis?page=1&limit=25');
  });

  it('sends the whole definition and the row version on update, with an idempotency key', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        ...item,
        variables: [],
        headers: [],
        body: null,
        functionCode: null,
        mapping: [],
        responseVariables: [],
        createdById: null,
      }),
    );
    await apiLibraryApi.update(ID, {
      method: 'GET',
      url: 'https://a.test',
      payloadType: 'application/json',
      variables: [],
      headers: [{ key: 'Authorization', value: '********', secret: true }],
      body: null,
      functionCode: null,
      mapping: [],
      responseVariables: [],
      rowVersion: 1,
    });
    const { url, init } = calls[0]!;
    expect(url).toBe(`/api/v2/api-library/apis/${ID}`);
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(JSON.parse(init.body as string).headers[0].value).toBe('********');
  });

  it('deletes plainly first and with force=true when flows use it', async () => {
    vi.stubGlobal('fetch', reply(204, undefined));
    await apiLibraryApi.remove(ID);
    await apiLibraryApi.remove(ID, true);
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v2/api-library/apis/${ID}`,
      `/api/v2/api-library/apis/${ID}?force=true`,
    ]);
    expect(calls.every((c) => c.init.method === 'DELETE')).toBe(true);
  });

  it('turns the in-use refusal into an ApiError that names the flows', async () => {
    vi.stubGlobal(
      'fetch',
      reply(409, {
        type: 'about:blank',
        title: 'In use',
        status: 409,
        code: ERROR_CODES.ALIB_IN_USE,
        errors: [{ path: 'f1', message: 'Welcome' }],
      }),
    );
    const e = await apiLibraryApi.remove(ID).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(ERROR_CODES.ALIB_IN_USE);
    expect((e as ApiError).fieldErrors).toEqual([{ path: 'f1', message: 'Welcome' }]);
  });

  it('reads a test run that failed as a normal answer (ok false)', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        ok: false,
        status: null,
        durationMs: 12,
        errorKind: 'blocked',
        error: 'Address is private',
        request: null,
        response: null,
        processedPayload: null,
        logId: null,
      }),
    );
    const r = await apiLibraryApi.test({
      method: 'GET',
      url: 'http://10.0.0.1',
      payloadType: 'application/json',
      variables: [],
      headers: [],
      body: null,
      functionCode: null,
      mapping: [],
      responseVariables: [],
      values: {},
    });
    expect(calls[0]!.url).toBe('/api/v2/api-library/apis/test');
    expect(r).toMatchObject({ ok: false, errorKind: 'blocked' });
  });

  it('reads the logs of one API, of all, and one log', async () => {
    vi.stubGlobal('fetch', reply(200, numbered([])));
    await apiLibraryApi.apiLogs(ID, { page: 3, limit: 50, status: 'failed' });
    await apiLibraryApi.logs({ page: 1, limit: 10, statusCode: 500, source: 'flow' });
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v2/api-library/apis/${ID}/logs?page=3&limit=50&status=failed`,
      '/api/v2/api-library/logs?page=1&limit=10&statusCode=500&source=flow',
    ]);
  });
});
