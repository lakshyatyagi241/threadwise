import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryBatch } from '../../../src/infra/providers/node-bridge-runtime/history.port';

/** A fake Baileys: keeps the config the adapter built the socket with, and lets a test fire `messaging-history.set`. */
const lib = vi.hoisted(() => ({
  config: null as null | Record<string, unknown>,
  sock: null as unknown,
}));
vi.mock('baileys', () => ({
  default: (config: Record<string, unknown>) => {
    lib.config = config;
    return lib.sock;
  },
  BufferJSON: { reviver: undefined, replacer: undefined },
  Browsers: { macOS: (b: string) => ['Mac OS', b, '14.4.1'] },
  downloadMediaMessage: async () => Buffer.from('file'),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
  fetchLatestWaWebVersion: async () => ({ version: [2, 3000, 1] }),
  initAuthCreds: () => ({}),
  makeCacheableSignalKeyStore: (k: unknown) => k,
  proto: { Message: { AppStateSyncKeyData: { fromObject: (x: unknown) => x } } },
}));

import { BaileysSocketFactory } from '../../../src/infra/providers/node-bridge-runtime/baileys.socket-factory';
import { SYNC_TYPE } from '../../../src/infra/providers/node-bridge-runtime/history-sync';

const store = {
  read: async () => null,
  readMany: async () => new Map(),
  write: async () => undefined,
};
const limits = {
  windowDays: (c: 'recent' | 'full') => (c === 'recent' ? 90 : 730),
  batchSize: () => 2,
};

async function open(historyImport?: 'none' | 'recent' | 'full', withLimits = true) {
  const ev = new EventEmitter();
  lib.sock = {
    ev: Object.assign(ev, { removeAllListeners: ev.removeAllListeners.bind(ev) }),
    user: { id: '919000000001:5@s.whatsapp.net' },
    end: () => undefined,
  };
  const socket = await new BaileysSocketFactory(
    store as never,
    {} as never,
    withLimits ? limits : undefined,
  ).create({
    orgId: 1,
    deviceId: 2,
    phoneDigits: '919000000001',
    proxy: null,
    ...(historyImport ? { historyImport } : {}),
  });
  return { socket, ev };
}

const msg = (id: string) => ({
  key: { id, remoteJid: '919800000001@s.whatsapp.net', fromMe: false },
  message: { conversation: id },
  messageTimestamp: Math.floor(Date.now() / 1000) - 3600,
});

describe('the Baileys socket is built from the history choice', () => {
  it('a device that did not opt in keeps the old settings and the desktop browser identity', async () => {
    await open();
    expect(lib.config).toMatchObject({
      syncFullHistory: false,
      browser: ['Mac OS', 'Desktop', '14.4.1'],
    });
    expect(
      (lib.config!.shouldSyncHistoryMessage as (n: unknown) => boolean)({
        syncType: SYNC_TYPE.RECENT,
      }),
    ).toBe(false);
    await open('none');
    expect(lib.config!.syncFullHistory).toBe(false);
  });

  it('recent allows the first-link chunks without asking for the full history; full asks for it', async () => {
    await open('recent');
    expect(lib.config!.syncFullHistory).toBe(false);
    expect(
      (lib.config!.shouldSyncHistoryMessage as (n: unknown) => boolean)({
        syncType: SYNC_TYPE.RECENT,
      }),
    ).toBe(true);
    await open('full');
    expect(lib.config!.syncFullHistory).toBe(true);
    expect(
      (lib.config!.shouldSyncHistoryMessage as (n: unknown) => boolean)({
        syncType: SYNC_TYPE.FULL,
      }),
    ).toBe(true);
  });
});

describe('a messaging-history.set event reaches the handler as bounded batches, one at a time', () => {
  it('waits for the handler before reading the next slice', async () => {
    const { socket, ev } = await open('recent');
    const seen: HistoryBatch[] = [];
    let release: () => void = () => undefined;
    let first = true;
    socket.subscribeHistory!(async (b) => {
      seen.push(b);
      if (first) {
        first = false;
        await new Promise<void>((r) => (release = r));
      }
    });
    ev.emit('messaging-history.set', {
      syncType: SYNC_TYPE.RECENT,
      progress: 100,
      messages: [msg('1'), msg('2'), msg('3')],
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1); // the second slice is not read while the first is being stored
    expect(seen[0]!.messages).toHaveLength(2);
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.map((b) => b.messages.length)).toEqual([2, 1]);
    expect(seen.map((b) => b.last)).toEqual([false, true]);
  });

  it('a socket built without an opt-in drops a stray history event', async () => {
    const { socket, ev } = await open('none');
    const seen: HistoryBatch[] = [];
    socket.subscribeHistory!(async (b) => void seen.push(b));
    ev.emit('messaging-history.set', { syncType: SYNC_TYPE.RECENT, messages: [msg('1')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
  });

  it('nothing is delivered once the socket was ended', async () => {
    const { socket, ev } = await open('recent');
    const seen: HistoryBatch[] = [];
    socket.subscribeHistory!(async (b) => void seen.push(b));
    socket.end();
    ev.emit('messaging-history.set', { syncType: SYNC_TYPE.RECENT, messages: [msg('1')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
  });
});

describe('a deployment without the limits provider', () => {
  it('fails loudly with a code instead of importing with a window nobody chose', async () => {
    const { socket, ev } = await open('full', false);
    const seen: HistoryBatch[] = [];
    socket.subscribeHistory!(async (b) => void seen.push(b));
    ev.emit('messaging-history.set', { syncType: SYNC_TYPE.FULL, messages: [msg('1')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ error: 'limits_unavailable', messages: [], last: true });
  });
});
