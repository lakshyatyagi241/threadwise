import { createRequire } from 'node:module';
import { createHook } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONNECTION_CONFIG } from 'baileys';
import { BaileysSocketFactory } from '../../../src/infra/providers/node-bridge-runtime/baileys.socket-factory';

/**
 * Sheet4 V-01. Baileys starts a repeating timer for every cache it builds and never stops it, so each socket that was ended stayed in
 * memory with its caches. The factory now hands the socket its own timerless caches; this pins that an ended socket leaves no repeating
 * timer behind. A local socket server stands in for WhatsApp (it accepts and never answers), so nothing leaves the machine.
 */
const req = createRequire(import.meta.url);
const { WebSocketServer } = createRequire(req.resolve('baileys'))('ws') as typeof import('ws');

describe('BaileysSocketFactory frees an ended socket', () => {
  let wss: import('ws').WebSocketServer;
  const original = DEFAULT_CONNECTION_CONFIG.waWebSocketUrl;
  const repeating = new Set<number>();
  const hook = createHook({
    init: (id, type, _t, resource) => {
      if (type === 'Timeout' && (resource as { _repeat?: number | null })._repeat)
        repeating.add(id);
    },
    destroy: (id) => repeating.delete(id),
  });

  beforeAll(async () => {
    wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((r) => wss.on('listening', r));
    DEFAULT_CONNECTION_CONFIG.waWebSocketUrl = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;
    hook.enable();
  });
  afterAll(() => {
    hook.disable();
    DEFAULT_CONNECTION_CONFIG.waWebSocketUrl = original;
    wss.close();
  });

  it('the detector sees a repeating timer (so a 0 below means none, not a blind spot)', async () => {
    const before = repeating.size;
    const h = setInterval(() => undefined, 60_000);
    expect(repeating.size - before).toBe(1);
    clearInterval(h);
    await new Promise((r) => setImmediate(r));
  });

  it('twenty sockets built and ended leave no repeating timer', async () => {
    const store = {
      read: async () => null,
      readMany: async () => new Map(),
      write: async () => undefined,
      deleteAll: async () => undefined,
    };
    const factory = new BaileysSocketFactory(store as never, {} as never);
    (factory as unknown as { waVersion: () => Promise<undefined> }).waVersion = async () =>
      undefined;
    const before = repeating.size;
    for (let i = 0; i < 20; i++) {
      const sock = await factory.create({
        orgId: 1,
        deviceId: i + 1,
        phoneDigits: '0',
        proxy: null,
        historyImport: 'none',
      });
      sock.subscribe(() => undefined);
      sock.end();
    }
    await new Promise((r) => setTimeout(r, 200));
    expect(repeating.size - before).toBe(0);
  });
});
