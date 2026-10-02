import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreditSourceConnection } from '../../../src/infra/providers/bsp-billing-engine/credit-source.port';
import { MetaCreditSource } from '../../../src/infra/providers/bsp-billing-engine/meta-credit-source';

interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: string;
}

/** A local stand-in for Meta's Graph API: records every request and answers what the test queued. */
let server: Server;
let seen: Seen[] = [];
let reply: (req: IncomingMessage) => { status: number; body?: unknown; delayMs?: number };

const TOKEN = 'EAAG-secret-system-user-token';
const conn = (over: Partial<CreditSourceConnection> = {}): CreditSourceConnection => ({
  businessId: '555',
  extendedCreditId: '',
  token: TOKEN,
  graphVersion: 'v26.0',
  ...over,
});

let source: MetaCreditSource;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body });
      const r = reply(req);
      setTimeout(() => {
        res.statusCode = r.status;
        res.setHeader('content-type', 'application/json');
        res.end(r.body === undefined ? '' : JSON.stringify(r.body));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
});
afterAll(async () => {
  await new Promise<void>((ok) => server.close(() => ok()));
});
beforeEach(() => {
  seen = [];
  reply = () => ({ status: 200, body: {} });
  source = new MetaCreditSource();
  source.transport = { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
});

describe('configuration check (TW-BSP-005)', () => {
  it('needs both the token and the business id; the credit line is optional', () => {
    expect(source.isConfigured({ businessId: '1', token: 't' })).toBe(true);
    expect(source.isConfigured({ businessId: '', token: 't' })).toBe(false);
    expect(source.isConfigured({ businessId: '1', token: '  ' })).toBe(false);
    expect(source.name).toBe('meta');
  });
});

describe('credit line resolution (TW-BSP-005 rule 3)', () => {
  it('a typed credit line id is used and Meta is not asked', async () => {
    expect(await source.resolveCreditLine(conn({ extendedCreditId: ' 999 ' }))).toBe('999');
    expect(seen).toHaveLength(0);
  });

  it('otherwise the first extended credit line of the business is read with the bearer token', async () => {
    reply = () => ({ status: 200, body: { data: [{ id: '111' }, { id: '222' }] } });
    expect(await source.resolveCreditLine(conn())).toBe('111');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', auth: `Bearer ${TOKEN}` });
    expect(seen[0]!.url).toBe('/v26.0/555/extendedcredits?fields=id,legal_entity_name');
  });

  it('no credit line, a Meta error or an unreachable Meta all resolve to null', async () => {
    reply = () => ({ status: 200, body: { data: [] } });
    expect(await source.resolveCreditLine(conn())).toBeNull();
    reply = () => ({ status: 400, body: { error: { message: 'Invalid token' } } });
    expect(await source.resolveCreditLine(conn())).toBeNull();
    source.transport = { baseUrl: 'http://127.0.0.1:1' };
    expect(await source.resolveCreditLine(conn())).toBeNull();
  });
});

describe('attach (TW-BSP-006 rule 6)', () => {
  it('posts the WABA and its currency as query parameters, never a body, and returns Meta allocation id', async () => {
    reply = () => ({ status: 200, body: { allocation_config_id: 'alloc-9' } });
    const res = await source.attach(conn(), '111', '2222', 'USD');
    expect(res).toEqual({ ok: true, allocationConfigId: 'alloc-9' });
    expect(seen[0]).toMatchObject({ method: 'POST', auth: `Bearer ${TOKEN}`, body: '' });
    expect(seen[0]!.url).toBe('/v26.0/111/whatsapp_credit_sharing_and_attach?waba_id=2222&waba_currency=USD');
  });

  it('a 2xx without an allocation id is a failure, not a success', async () => {
    reply = () => ({ status: 200, body: { success: true } });
    const res = await source.attach(conn(), '111', '2222', 'USD');
    expect(res.ok).toBe(false);
  });

  it('shows Meta own error message, or the status when it gave none', async () => {
    reply = () => ({ status: 400, body: { error: { message: 'WABA already has a payment method' } } });
    expect(await source.attach(conn(), '111', '2222', 'USD')).toEqual({
      ok: false,
      error: 'WABA already has a payment method',
    });
    reply = () => ({ status: 502 });
    expect(await source.attach(conn(), '111', '2222', 'USD')).toEqual({ ok: false, error: 'HTTP 502' });
  });

  it('never echoes the token, even when Meta does', async () => {
    reply = () => ({ status: 401, body: { error: { message: `Invalid OAuth access token ${TOKEN}` } } });
    const res = await source.attach(conn(), '111', '2222', 'USD');
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });

  it('a Meta that does not answer in time becomes a readable failure, not an exception', async () => {
    reply = () => ({ status: 200, body: { allocation_config_id: 'late' }, delayMs: 400 });
    source.transport = { ...source.transport, timeoutMs: 50 };
    expect(await source.attach(conn(), '111', '2222', 'USD')).toEqual({
      ok: false,
      error: 'Meta did not answer in time.',
    });
  });

  it('an unreachable Meta is a readable failure too', async () => {
    source.transport = { baseUrl: 'http://127.0.0.1:1' };
    expect(await source.attach(conn(), '111', '2222', 'USD')).toEqual({
      ok: false,
      error: 'Could not reach Meta.',
    });
  });

  it('uses the Graph version it was given', async () => {
    reply = () => ({ status: 200, body: { allocation_config_id: 'a' } });
    await source.attach(conn({ graphVersion: 'v25.0' }), '111', '2222', 'INR');
    expect(seen[0]!.url.startsWith('/v25.0/111/')).toBe(true);
  });
});

describe('revoke (TW-BSP-009 rule 1)', () => {
  it('deletes the stored allocation id', async () => {
    reply = () => ({ status: 200, body: { success: true } });
    expect(await source.revoke(conn(), 'alloc-9')).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ method: 'DELETE', url: '/v26.0/alloc-9', auth: `Bearer ${TOKEN}` });
  });

  it('an empty allocation id fails locally with the Reference wording, without calling Meta', async () => {
    expect(await source.revoke(conn(), '')).toEqual({ ok: false, error: 'No allocation id to revoke.' });
    expect(seen).toHaveLength(0);
  });

  it('a refusal comes back as text', async () => {
    reply = () => ({ status: 400, body: { error: { message: 'Allocation not found' } } });
    expect(await source.revoke(conn(), 'x')).toEqual({ ok: false, error: 'Allocation not found' });
  });
});
