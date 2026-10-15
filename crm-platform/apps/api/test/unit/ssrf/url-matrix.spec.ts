import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardedRequest } from '../../../src/infra/net/guarded-http';
import { SafeFetch } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { assertPublicUrl } from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';
import { guardSsrf } from '../../../src/modules/flow-builder-editor/ssrf-guard';
import { assertPublicTarget } from '../../../src/modules/webhook-fanout/url-guard';

/** Every URL spelling that points at something internal or uses a scheme we never fetch. */
const MUST_REFUSE = [
  'http://127.0.0.1/',
  'http://localhost/',
  'http://localhost./',
  'http://LOCALHOST/',
  'http://foo.localhost/',
  'http://[::1]/',
  'http://[::]/',
  'http://[::ffff:127.0.0.1]/',
  'http://[::ffff:7f00:1]/',
  'http://[64:ff9b::7f00:1]/',
  'http://[2002:7f00:1::]/',
  'http://[fe80::1]/',
  'http://[fd00:ec2::254]/',
  'http://2130706433/',
  'http://0x7f000001/',
  'http://0x7f.0.0.1/',
  'http://017700000001/',
  'http://127.1/',
  'http://127.0.0.1./',
  'http://0/',
  'http://0.0.0.0/',
  'http://10.0.0.5:8080/admin',
  'http://192.168.0.1/',
  'http://172.16.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://metadata.google.internal/computeMetadata/v1/',
  'http://169.254.169.254.nip.io@127.0.0.1/',
  'http://user:pw@127.0.0.1/',
  'http://good.example.com@127.0.0.1/',
  'http://127.0.0.1#@good.example.com/',
  'http://127.0.0.1%2523@good.example.com/',
  'http://①②⑦.0.0.1/',
  'http://１２７.0.0.1/',
  'file:///etc/passwd',
  'gopher://127.0.0.1:70/_x',
  'ftp://127.0.0.1/',
  'dict://127.0.0.1:11211/',
  'javascript:alert(1)',
  'not a url',
  '',
];
/** What the fake resolver answers for names: internal for every spelling of localhost, nothing for the rest. */
const fakeResolve = async (host: string) =>
  /localhost|^foo\./.test(host) ? [{ address: '127.0.0.1', family: 4 }] : [];

const refusedBy: Record<string, (u: string) => Promise<boolean>> = {
  'flow-builder guardSsrf': async (u) => !(await guardSsrf(u, fakeResolve)).ok,
  'webhook-fanout assertPublicTarget (https form)': async (u) =>
    (await assertPublicTarget(u.replace(/^http:/, 'https:'))) !== null,
  'SafeFetch.request': (u) =>
    new SafeFetch().request(u, { timeoutMs: 2000 }).then(
      () => false,
      () => true,
    ),
  guardedRequest: async (u) => {
    try {
      return await guardedRequest({
        method: 'GET',
        url: new URL(u),
        headers: {},
        timeoutMs: 2000,
        allowPrivate: false,
        maxBytes: 1024,
      }).then(
        () => false,
        () => true,
      );
    } catch {
      return true; // not even a URL
    }
  },
  'waba assertPublicUrl': (u) =>
    assertPublicUrl(u, { resolve: async (h) => (await fakeResolve(h)).map((a) => a.address) }).then(
      () => false,
      () => true,
    ),
};

describe.each(Object.entries(refusedBy))('url rule: %s', (_n, refused) => {
  it.each(MUST_REFUSE)('refuses %j', async (u) => expect(await refused(u)).toBe(true));
});

describe('a redirect is never followed to an internal target', () => {
  let internalHits = 0;
  let internal: Server;
  let bouncer: Server;
  beforeAll(async () => {
    internal = createServer((_q, r) => {
      internalHits++;
      r.end('secret');
    });
    await new Promise<void>((ok) => internal.listen(0, '127.0.0.1', ok));
    const target = `http://127.0.0.1:${(internal.address() as AddressInfo).port}/`;
    bouncer = createServer((_q, r) => {
      r.writeHead(302, { location: target });
      r.end();
    });
    await new Promise<void>((ok) => bouncer.listen(0, '127.0.0.1', ok));
  });
  afterAll(() => {
    internal.close();
    bouncer.close();
  });

  it('SafeFetch.request answers the 3xx and stops', async () => {
    const f = new SafeFetch();
    f.isBlocked = () => false; // the test server is on loopback
    const res = await f.request(`http://127.0.0.1:${(bouncer.address() as AddressInfo).port}/`, {
      timeoutMs: 2000,
    });
    expect(res.status).toBe(302);
    expect(internalHits).toBe(0);
  });
  it('guardedRequest answers the 3xx and stops', async () => {
    const res = await guardedRequest({
      method: 'GET',
      url: new URL(`http://127.0.0.1:${(bouncer.address() as AddressInfo).port}/`),
      headers: {},
      timeoutMs: 2000,
      allowPrivate: true,
      maxBytes: 1024,
    });
    expect(res.status).toBe(302);
    expect(internalHits).toBe(0);
  });
});

describe('a public name is allowed (control)', () => {
  const pub = async () => [{ address: '93.184.216.34', family: 4 }];
  it('guardSsrf', async () =>
    expect((await guardSsrf('https://example.com/x', pub)).ok).toBe(true));
  it('waba assertPublicUrl', async () =>
    expect(
      assertPublicUrl('https://example.com/x', { resolve: async () => ['93.184.216.34'] }),
    ).resolves.toBeUndefined());
});
