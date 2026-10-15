import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startRemoteAppsScript, type RemoteAppsScript } from '../../support/apps-script-remote';

/**
 * The synchronous bridge: the add-on's `UrlFetchApp.fetch` is synchronous, the HTTP server lives in this very thread, and the script runs in
 * a worker that blocks until this thread has made the real request. If the bridge deadlocked, every call here would time out.
 */
const KEY = `wsn_live_${'a'.repeat(32)}`;
const HOOK = `https://api.example.com/api/v1/sheets-addon/webhook/${KEY}`;
const stops: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function start(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  stops.push(() => new Promise((r) => server.close(r)));
  const serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const remote: RemoteAppsScript = await startRemoteAppsScript({
    serverUrl,
    headers: { 'x-test': '1' },
  });
  stops.push(() => remote.stop());
  return { remote, serverUrl };
}

describe('the worker bridge to a real HTTP server', () => {
  it('lets the unchanged add-on make a real request and read the real answer', async () => {
    const seen: Array<{ url?: string; auth?: string; test?: string }> = [];
    const { remote } = await start((req, res) => {
      seen.push({
        url: req.url,
        auth: req.headers.authorization,
        test: req.headers['x-test'] as string,
      });
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          ok: true,
          user: { name: 'X' },
          workspace: {},
          can: { read_contacts: true },
        }),
      );
    });
    const r = await remote.callFromClient('saveKey', HOOK);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ ok: true, masked: 'wsn_live_••••••••aaaaaaaa' });
    expect(seen).toEqual([
      { url: '/api/v1/sheets-addon/health', auth: `Bearer ${KEY}`, test: '1' },
    ]);
    expect(remote.httpLog.map((l) => l.status)).toEqual([200]);
  });

  it('carries a status, headers and an error body back (a 429 with Retry-After is waited out, then read)', async () => {
    let calls = 0;
    const { remote } = await start((_req, res) => {
      calls++;
      res.setHeader('content-type', 'application/json');
      if (calls <= 3) {
        res.statusCode = 429;
        res.setHeader('Retry-After', '45');
        res.end(JSON.stringify({ ok: false, code: 'RATE_LIMITED', error: 'slow' }));
      } else res.end('{}');
    });
    const r = await remote.callFromClient('saveKey', HOOK);
    expect(r.value).toMatchObject({
      ok: false,
      status: 429,
      retryAfter: 45,
      message: 'Too many requests. Wait 45 seconds and try again.',
    });
    expect(calls).toBe(1);
  });

  it('turns a refused connection into the exception Apps Script throws, which the add-on reports as NETWORK', async () => {
    const { remote, serverUrl } = await start((_req, res) => res.end('{}'));
    stops.splice(0).forEach((s) => void s());
    const closed = await startRemoteAppsScript({ serverUrl });
    stops.push(() => closed.stop());
    const r = await closed.callFromClient('saveKey', HOOK);
    expect(r.value).toMatchObject({ ok: false, code: 'NETWORK' });
    expect(remote).toBeDefined();
  });

  it('keeps the worker state between calls (properties, sheets) and answers many calls in a row', async () => {
    const { remote } = await start((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, user: {}, workspace: {}, can: {} }));
    });
    await remote.loadSheet('Leads', [['Email'], ['a@example.com']], { activate: true });
    await remote.callFromClient('saveKey', HOOK);
    for (let i = 0; i < 20; i++)
      expect((await remote.callFromClient('checkConnection')).ok).toBe(true);
    expect((await remote.properties('user')).CRM_SHEETS_KEY).toBe(KEY);
    expect(await remote.grid('Leads')).toEqual([['Email'], ['a@example.com']]);
    expect(await remote.hasFunction('crmScheduledSend')).toBe(true);
  });

  it('reports an error thrown by a harness method', async () => {
    const { remote } = await start((_req, res) => res.end('{}'));
    await expect(remote.clickMenu('No such item')).rejects.toThrow(/No menu item/);
  });
});
