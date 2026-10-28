import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  MAX_RESPONSE_BYTES,
  pinnedFetch,
} from '../../../src/infra/providers/marketplace/pull.connector';
import {
  resolvePublicUrl,
  UnsafeProviderUrlError,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';

/**
 * #1272: the address the guard approves is the address the connection uses. The name `portal.example.test` does not resolve in a test
 * run, so a request that reaches the local server proves the connection went to the pinned address and did not look the name up again.
 */

let server: Server;
let port = 0;
const seen: Array<{ url: string; host: string | undefined }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', host: req.headers.host });
    if (req.url?.startsWith('/big')) {
      res.writeHead(200, { 'content-type': 'text/plain', 'retry-after': '7' });
      res.end('x'.repeat(MAX_RESPONSE_BYTES + 500_000));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});

const init = { method: 'GET', headers: {}, redirect: 'manual' as const };

describe('#1272 the connection goes to the address the guard approved', () => {
  it('resolvePublicUrl returns the approved address and looks the name up once', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34']);
    const approved = await resolvePublicUrl('https://portal.example.com/leads', { resolve });
    expect(approved).toBe('93.184.216.34');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('resolvePublicUrl refuses a name that has any private address in its answer', async () => {
    const resolve = async () => ['93.184.216.34', '10.0.0.5'];
    await expect(
      resolvePublicUrl('https://portal.example.com/leads', { resolve }),
    ).rejects.toBeInstanceOf(UnsafeProviderUrlError);
  });

  it('pinnedFetch connects to the pinned address and sends the recipe host as the Host header', async () => {
    seen.length = 0;
    const res = await pinnedFetch(
      `http://portal.example.test:${port}/leads?page=2`,
      init,
      '127.0.0.1',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":true}');
    expect(seen).toEqual([{ url: '/leads?page=2', host: `portal.example.test:${port}` }]);
  });

  it('pinnedFetch reads the answer only up to the cap and reports it truncated', async () => {
    const res = await pinnedFetch(`http://portal.example.test:${port}/big`, init, '127.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers?.get('retry-after')).toBe('7');
    const text = await res.text();
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });
});
