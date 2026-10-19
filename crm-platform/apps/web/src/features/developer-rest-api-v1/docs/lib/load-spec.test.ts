import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ apiBase: () => 'http://api.internal:3000' }));

import { loadDocs, publicApiOrigin } from './load-spec';

const doc = {
  info: { title: 'Acme API' },
  paths: { '/api/v1/me': { get: { tags: ['Account'], responses: {} } } },
};
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadDocs', () => {
  it('asks the API origin (server side) for /docs/api.json with a one-minute revalidate and builds the reference with the public origin', async () => {
    fetchMock.mockReturnValue(reply(doc));
    const data = await loadDocs('https://api.example.com');
    expect(fetchMock.mock.calls[0]![0]).toBe('http://api.internal:3000/docs/api.json');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ next: { revalidate: 60 } });
    expect(data.status).toBe('ok');
    if (data.status === 'ok')
      expect(data.reference.groups[0]!.endpoints[0]!.url).toBe('https://api.example.com/api/v1/me');
  });

  it('is empty for a valid document with no operation', async () => {
    fetchMock.mockReturnValue(reply({ paths: {} }));
    expect((await loadDocs('https://a.test')).status).toBe('empty');
  });

  it('is unavailable on a network error, a timeout, a non-200 or a body that is not an OpenAPI object', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await loadDocs('https://a.test')).toEqual({ status: 'unavailable' });
    fetchMock.mockReturnValueOnce(reply({}, 503));
    expect(await loadDocs('https://a.test')).toEqual({ status: 'unavailable' });
    fetchMock.mockReturnValueOnce(reply({ nothing: true }));
    expect(await loadDocs('https://a.test')).toEqual({ status: 'unavailable' });
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await loadDocs('https://a.test')).toEqual({ status: 'unavailable' });
  });
});

describe('publicApiOrigin', () => {
  it('prefers PUBLIC_API_URL, then APP_URL, then API_URL, then localhost', () => {
    const keep = { ...process.env };
    delete process.env.PUBLIC_API_URL;
    delete process.env.APP_URL;
    delete process.env.API_URL;
    expect(publicApiOrigin()).toBe('http://localhost:3000');
    process.env.API_URL = 'http://a.test';
    expect(publicApiOrigin()).toBe('http://a.test');
    process.env.APP_URL = 'http://b.test';
    expect(publicApiOrigin()).toBe('http://b.test');
    process.env.PUBLIC_API_URL = 'http://c.test';
    expect(publicApiOrigin()).toBe('http://c.test');
    process.env = keep;
  });
});
