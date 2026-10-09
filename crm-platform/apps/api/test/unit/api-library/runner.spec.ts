import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_LIBRARY_SECRET_MASK } from '@crm/contracts';
import { isBlockedAddress } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import {
  ApiLibraryRunner,
  type RunnableDefinition,
} from '../../../src/modules/api-library/api-library-runner.service';

/** The runner against a real local HTTP server; only 127.0.0.1 is let through the address check, every other private address stays blocked. */
let server: Server;
let base: string;
const seen: Array<{
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const path = (req.url ?? '').split('?')[0];
      if (path === '/json') {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=1' });
        res.end(JSON.stringify({ data: { id: 5, name: 'Ada' }, token: 'secret-in-body' }));
      } else if (path === '/text') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('plain answer');
      } else if (path === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(2 * 1024 * 1024));
      } else if (path === '/redirect') {
        res.writeHead(302, { location: 'http://10.0.0.5/internal' });
        res.end();
      } else if (path === '/teapot') {
        res.writeHead(418, { 'content-type': 'application/json' });
        res.end('{"error":"teapot"}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const runner = new ApiLibraryRunner();
runner.safeFetch.isBlocked = (a) => a !== '127.0.0.1' && isBlockedAddress(a);

const def = (over: Partial<RunnableDefinition> = {}): RunnableDefinition => ({
  method: 'GET',
  url: `${base}/json`,
  payloadType: 'application/json',
  headers: [],
  body: null,
  functionCode: null,
  ...over,
});
const none = new Map<string, string>();

describe('a run of a saved API', () => {
  it('returns status, parsed body and a log snapshot with secrets masked', async () => {
    seen.length = 0;
    const out = await runner.run(
      def({
        url: `${base}/json?api_key={{k}}&q=1`,
        headers: [
          { key: 'Authorization', value: 'Bearer {{k}}', secret: true },
          { key: 'X-Plain', value: 'hello', secret: false },
        ],
      }),
      new Map([['k', 'REAL-KEY']]),
    );
    expect(out).toMatchObject({ ok: true, status: 200, errorKind: null, error: null });
    expect(out.response?.bodyJson).toEqual({
      data: { id: 5, name: 'Ada' },
      token: 'secret-in-body',
    });
    expect(out.response?.headers['set-cookie']).toEqual([API_LIBRARY_SECRET_MASK]);
    // what the target received is real, what the snapshot keeps is masked
    expect(seen[0]!.headers.authorization).toBe('Bearer REAL-KEY');
    expect(seen[0]!.url).toContain('api_key=REAL-KEY');
    expect(out.request).toEqual({
      method: 'GET',
      url: `${base}/json?api_key=${API_LIBRARY_SECRET_MASK}&q=1`,
      headers: { Authorization: API_LIBRARY_SECRET_MASK, 'X-Plain': 'hello' },
      body: null,
    });
    expect(JSON.stringify(out)).not.toContain('REAL-KEY');
  });

  it('sends a JSON payload with the variables filled in, and masks secret keys in the snapshot', async () => {
    seen.length = 0;
    const out = await runner.run(
      def({ method: 'POST', body: { id: '{{id}}', password: 'hunter2', n: 3 } }),
      new Map([['id', '77']]),
    );
    expect(out.ok).toBe(true);
    expect(seen[0]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(seen[0]!.body)).toEqual({ id: '77', password: 'hunter2', n: 3 });
    expect(seen[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(out.request!.body!)).toEqual({
      id: '77',
      password: API_LIBRARY_SECRET_MASK,
      n: 3,
    });
  });

  it('reshapes the payload with the processing function in the sandbox', async () => {
    seen.length = 0;
    const out = await runner.run(
      def({
        method: 'PUT',
        body: { age: 4, name: '{{n}}' },
        functionCode:
          'function processPayload(payload) { payload.age += 5; payload.status = "Updated"; return payload; }',
      }),
      new Map([['n', 'Ada']]),
    );
    expect(out.ok).toBe(true);
    expect(JSON.parse(seen[0]!.body)).toEqual({ age: 9, name: 'Ada', status: 'Updated' });
    expect(out.processedPayload).toEqual({ age: 9, name: 'Ada', status: 'Updated' });
  });

  it('a function that throws, loops or returns nothing stops the run before anything is sent', async () => {
    seen.length = 0;
    const bad = async (functionCode: string) =>
      runner.run(def({ method: 'POST', body: { a: 1 }, functionCode }), none);
    const thrown = await bad('function processPayload(p) { throw new Error("boom"); }');
    expect(thrown).toMatchObject({ ok: false, errorKind: 'function', request: null });
    expect(thrown.error).toContain('boom');
    const empty = await bad('function processPayload(p) { }');
    expect(empty).toMatchObject({ ok: false, errorKind: 'function' });
    const spin = await bad('function processPayload(p) { while (true) {} }');
    expect(spin).toMatchObject({ ok: false, errorKind: 'function' });
    const escape = await bad(
      'function processPayload(p) { return { v: typeof process + typeof require }; }',
    );
    expect(escape.ok).toBe(true);
    expect(JSON.parse(seen[0]!.body)).toEqual({ v: 'undefinedundefined' });
    expect(seen).toHaveLength(1);
  }, 20_000);

  it("sends the step key as Idempotency-Key on a request that changes something, never on a GET or over the author's own", async () => {
    seen.length = 0;
    await runner.run(def({ method: 'POST', body: { a: 1 }, idempotencyKey: 'flow:1:2:n' }), none);
    await runner.run(def({ idempotencyKey: 'flow:1:2:n' }), none);
    await runner.run(
      def({
        method: 'DELETE',
        idempotencyKey: 'flow:1:2:n',
        headers: [{ key: 'idempotency-key', value: 'mine', secret: false }],
      }),
      none,
    );
    expect(seen.map((r) => r.headers['idempotency-key'])).toEqual([
      'flow:1:2:n',
      undefined,
      'mine',
    ]);
  });

  it('sends multipart/form-data as text fields', async () => {
    seen.length = 0;
    const out = await runner.run(
      def({ method: 'POST', payloadType: 'multipart/form-data', body: { a: '{{x}}', token: 't' } }),
      new Map([['x', 'one']]),
    );
    expect(out.ok).toBe(true);
    expect(seen[0]!.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen[0]!.body).toContain('name="a"\r\n\r\none');
    expect(JSON.parse(out.request!.body!)).toEqual({ a: 'one', token: API_LIBRARY_SECRET_MASK });
  });

  it('a non-2xx answer is a failed run with the status and the body', async () => {
    const out = await runner.run(def({ url: `${base}/teapot` }), none);
    expect(out).toMatchObject({ ok: false, status: 418, errorKind: 'status' });
    expect(out.error).toContain('418');
    expect(out.response?.bodyJson).toEqual({ error: 'teapot' });
  });

  it('keeps plain text, and cuts an answer larger than the cap instead of failing', async () => {
    const text = await runner.run(def({ url: `${base}/text` }), none);
    expect(text.response).toMatchObject({
      bodyText: 'plain answer',
      bodyJson: null,
      truncated: false,
    });
    const big = await runner.run(def({ url: `${base}/big` }), none);
    expect(big).toMatchObject({ ok: true, status: 200 });
    expect(big.response?.truncated).toBe(true);
    expect(big.response?.bodyText.length).toBe(64 * 1024);
    expect(big.response?.sizeBytes).toBe(1024 * 1024);
  });

  it('does not follow a redirect (a public host cannot bounce a call onto an internal one)', async () => {
    const out = await runner.run(def({ url: `${base}/redirect` }), none);
    expect(out).toMatchObject({ ok: false, status: 302, errorKind: 'status' });
    expect(out.error).toContain('redirects are not followed');
  });

  it.each([
    'http://10.0.0.5/x',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
  ])('refuses %s as blocked before connecting', async (url) => {
    const out = await runner.run(def({ url }), none);
    expect(out).toMatchObject({ ok: false, status: null, errorKind: 'blocked' });
    expect(out.error).toContain('private or internal');
  });

  it('with the real address check, loopback is refused too (the override above exists only for this test server)', async () => {
    const strict = new ApiLibraryRunner();
    for (const url of [`${base}/json`, 'http://localhost/', 'http://127.1/']) {
      const out = await strict.run(def({ url }), none);
      expect(out, url).toMatchObject({ ok: false, status: null, errorKind: 'blocked' });
    }
  });

  it('refuses a non-http scheme and a connection that fails', async () => {
    const scheme = await runner.run(def({ url: 'file:///etc/passwd' }), none);
    expect(scheme.errorKind).toBe('invalid');
    const refused = await runner.run(def({ url: 'http://127.0.0.1:1/' }), none);
    expect(refused).toMatchObject({ ok: false, errorKind: 'network' });
  });
});
