import { afterEach, describe, expect, it } from 'vitest';
import { guardedRequest } from '../../../src/infra/net/guarded-http';
import { SafeFetch } from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { WabaHttp } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { readWabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import {
  closedPortUrl,
  startFaultServer,
  timed,
  until,
  type Fault,
  type FaultServer,
} from './fault-server';

/**
 * What the outbound clients do when the other side fails: refuses, resets, goes silent, stops mid-answer, trickles bytes, sends
 * an oversize or malformed answer. Each case must (1) end, within the client's own deadline, (2) with an error the caller can
 * classify, (3) without leaving a socket open. A client that can wait forever holds a worker for as long as the other side likes.
 */
const TIMEOUT_MS = 300;
/** The deadline plus time for the event loop and the socket to close. */
const SLACK_MS = 1200;

let servers: FaultServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close()));
  servers = [];
});
async function fault(kind: Fault): Promise<FaultServer> {
  const s = await startFaultServer(kind);
  servers.push(s);
  return s;
}

const FAILING: Fault[] = ['reset', 'hang', 'headers-then-hang', 'truncated', 'drip'];

describe('guardedRequest (customer webhooks, fan-out, WooCommerce)', () => {
  const call = (url: string, maxBytes = 1024) =>
    guardedRequest({
      method: 'GET',
      url: new URL(url),
      headers: {},
      timeoutMs: TIMEOUT_MS,
      allowPrivate: true, // the fault server is on loopback
      maxBytes,
    });

  it('a refused connection fails at once', async () => {
    const url = await closedPortUrl();
    const r = await timed(() => call(url));
    expect(r.error).toBeInstanceOf(Error);
    expect(r.ms).toBeLessThan(SLACK_MS);
  });

  it.each(FAILING)('%s ends within the deadline and frees the socket', async (kind) => {
    const s = await fault(kind);
    const r = await timed(() => call(s.url));
    // `drip` sends a byte every 50 ms for as long as it is allowed to: only an overall deadline stops it.
    expect(r.ms, `${kind} took ${Math.round(r.ms)} ms`).toBeLessThan(SLACK_MS);
    expect(r.error, kind).toBeInstanceOf(Error);
    expect(await until(() => s.open() === 0), `${kind} left a socket open`).toBe(true);
  });

  it('reports a 5xx as an answer, not an exception, so the caller can read the status', async () => {
    const s = await fault('status503-retry-after');
    const r = await call(s.url);
    expect(r.status).toBe(503);
    expect(r.headers['retry-after']).toBe('7');
  });

  it('stops reading an oversize answer and frees the socket', async () => {
    const s = await fault('huge');
    const r = await timed(() => call(s.url, 1024));
    expect(r.ms).toBeLessThan(SLACK_MS);
    if (r.value) expect(Buffer.byteLength(r.value.body)).toBeLessThanOrEqual(1024);
    expect(await until(() => s.open() === 0), 'the connection was left streaming').toBe(true);
  });
});

describe('SafeFetch.request (API Library, flow Webhook node)', () => {
  const call = (url: string, maxBytes = 1024) => {
    const f = new SafeFetch();
    f.isBlocked = () => false; // loopback test server
    return f.request(url, { timeoutMs: TIMEOUT_MS, maxBytes, truncate: true });
  };

  it('a refused connection fails at once', async () => {
    const url = await closedPortUrl();
    const r = await timed(() => call(url));
    expect(r.error).toBeInstanceOf(Error);
    expect(r.ms).toBeLessThan(SLACK_MS);
  });

  it.each(FAILING)('%s ends within the deadline and frees the socket', async (kind) => {
    const s = await fault(kind);
    const r = await timed(() => call(s.url));
    expect(r.ms, `${kind} took ${Math.round(r.ms)} ms`).toBeLessThan(SLACK_MS);
    // `truncate` mode turns a cut-off answer into a flagged partial result; either way it must end.
    expect(await until(() => s.open() === 0), `${kind} left a socket open`).toBe(true);
  });

  it('a stalled answer is never reported as a complete success', async () => {
    const s = await fault('headers-then-hang');
    const r = await timed(() => call(s.url));
    if (r.value) expect(r.value.truncated, 'a cut-off body looked complete').toBe(true);
  });

  it('caps an oversize answer and frees the socket', async () => {
    const s = await fault('huge');
    const r = await timed(() => call(s.url, 2048));
    expect(r.ms).toBeLessThan(SLACK_MS);
    expect(r.value?.truncated).toBe(true);
    expect(Buffer.byteLength(r.value?.text ?? '')).toBeLessThanOrEqual(2048);
    expect(await until(() => s.open() === 0)).toBe(true);
  });
});

describe('WabaHttp (WhatsApp Cloud API, Interakt)', () => {
  const http = (url: string) =>
    new WabaHttp(
      readWabaEnv({
        META_API_ENDPOINT: url.replace(/\/$/, ''),
        META_API_VERSION: 'v25.0',
        WABA_HTTP_TIMEOUT_MS: '1000', // the schema's minimum; each call below sets its own shorter deadline
      }),
    );
  const get = (url: string) =>
    http(url).graph<Record<string, unknown>>('tok', {
      method: 'GET',
      path: '/me',
      timeoutMs: TIMEOUT_MS,
    });

  it('a refused connection becomes a classified network error', async () => {
    const url = await closedPortUrl();
    const r = await timed(() => get(url));
    expect(r.error).toBeInstanceOf(WabaApiError);
    expect((r.error as WabaApiError).status).toBe(0);
    expect(r.ms).toBeLessThan(SLACK_MS);
  });

  it.each(['reset', 'hang'] as const)(
    '%s ends within the deadline as a network error',
    async (kind) => {
      const s = await fault(kind);
      const r = await timed(() => get(s.url));
      expect(r.ms, `${kind} took ${Math.round(r.ms)} ms`).toBeLessThan(SLACK_MS);
      expect(r.error).toBeInstanceOf(WabaApiError);
      expect((r.error as WabaApiError).status).toBe(0);
      expect(await until(() => s.open() === 0)).toBe(true);
    },
  );

  it.each(['headers-then-hang', 'truncated', 'drip'] as const)(
    '%s (answer starts, then fails) is not treated as a successful send',
    async (kind) => {
      const s = await fault(kind);
      const r = await timed(() => get(s.url));
      expect(r.ms, `${kind} took ${Math.round(r.ms)} ms`).toBeLessThan(SLACK_MS);
      // A 200 whose body never finished must not look like "sent": the caller reads a message id out of the body.
      expect(r.error, `${kind} returned ${JSON.stringify(r.value)} as a success`).toBeInstanceOf(
        WabaApiError,
      );
      expect(await until(() => s.open() === 0)).toBe(true);
    },
  );

  it('a 5xx is a typed error carrying the status', async () => {
    const s = await fault('status500');
    const r = await timed(() => get(s.url));
    expect(r.error).toBeInstanceOf(WabaApiError);
    expect((r.error as WabaApiError).status).toBe(500);
  });

  it('a 200 that is not JSON does not crash the caller', async () => {
    const s = await fault('badjson');
    const r = await timed(() => get(s.url));
    // Either a typed error or a result carrying the raw text; never an unhandled exception.
    if (r.error) expect(r.error).toBeInstanceOf(WabaApiError);
    else expect(r.value).toBeTypeOf('object');
  });

  it('an error message never carries the bearer token', async () => {
    const s = await fault('reset');
    const r = await timed(() => get(s.url));
    expect(String((r.error as Error).message)).not.toContain('tok');
  });
});
