import { Injectable, Logger } from '@nestjs/common';
import makeWASocket, {
  BufferJSON,
  Browsers,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WAVersion,
} from 'baileys';
import pino from 'pino';
import type { SocketEvent, SocketTarget, WaSocket, WaSocketFactory } from './socket.port';
import { DeviceAuthStore } from './device-auth-store';
import { buildProxyAgent, probeProxy } from './proxy';

const VERSION_TTL_MS = 60 * 60 * 1000;

/** What the runtime learns about a device's proxy each time it connects (TW-NODE-013 rule 2). */
export interface ProxyResultSink {
  report(
    orgId: number,
    deviceId: number,
    result: { ok: boolean; egressIp?: string; error?: string },
  ): Promise<void>;
}
export const PROXY_RESULT_SINK = Symbol('PROXY_RESULT_SINK');

/**
 * The unofficial WhatsApp engine (TW-NODE-011): Baileys behind the runtime's socket port. This file is the only place that
 * knows the library. Settings are Reference's, value for value: the long query timeout (120 s, so a slow send is not reported
 * failed and retried into a duplicate), the 15 s keep-alive, no history sync, no "online" on connect, and a `getMessage` that
 * answers nothing (a placeholder text made WhatsApp loop on decryption).
 *
 * Not verified against a live WhatsApp session in this repository: everything around it (the state machine, the persistence,
 * the status flow) is tested with a fake socket, and this adapter is checked by the compiler against the library's types.
 */
@Injectable()
export class BaileysSocketFactory implements WaSocketFactory {
  private readonly logger = new Logger(BaileysSocketFactory.name);
  private version: { at: number; value: WAVersion | undefined } | null = null;
  /** Set by the runtime so a proxy result reaches the device row. */
  proxyResults: ProxyResultSink | null = null;

  constructor(private readonly store: DeviceAuthStore) {}

  async create(target: SocketTarget): Promise<WaSocket> {
    const agent = target.proxy ? buildProxyAgent(target.proxy) : undefined;
    if (agent) {
      // Fail closed: a proxy that does not answer means no connection, never a connection from this server's own address.
      const probe = await probeProxy(agent, process.env.NODE_PROXY_ECHO_URL || undefined);
      await this.proxyResults?.report(target.orgId, target.deviceId, probe).catch(() => undefined);
      if (!probe.ok) throw new Error(`Proxy unreachable: ${probe.error ?? 'no answer'}`);
    }

    const { creds, keys, saveCreds } = await this.loadState(target.orgId, target.deviceId);
    const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || 'warn' });
    const version = await this.waVersion();
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds, keys: makeCacheableSignalKeyStore(keys, logger) },
      logger,
      browser: Browsers.macOS('Desktop'),
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 120_000,
      keepAliveIntervalMs: 15_000,
      retryRequestDelayMs: 3_000,
      maxMsgRetryCount: 5,
      qrTimeout: 60_000,
      emitOwnEvents: false,
      fireInitQueries: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldSyncHistoryMessage: () => false,
      transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3_000 },
      getMessage: async () => undefined,
      generateHighQualityLinkPreview: false,
      ...(agent ? { agent, fetchAgent: agent } : {}),
    });

    let listener: ((e: SocketEvent) => void) | null = null;
    const backlog: SocketEvent[] = [];
    let ended = false;
    const emit = (e: SocketEvent) => {
      if (ended) return;
      if (listener) listener(e);
      else backlog.push(e);
    };
    let firstSignal: () => void = () => undefined;
    const signalled = new Promise<void>((r) => (firstSignal = r));

    sock.ev.on('connection.update', (u) => {
      if (u.connection === 'connecting') {
        firstSignal();
        emit({ type: 'connecting' });
      }
      if (u.qr) {
        firstSignal();
        emit({ type: 'qr', qr: u.qr });
      }
      if (u.connection === 'open') {
        emit({ type: 'open', linkedId: sock.user?.id });
        // Reference saved the credentials again two seconds after opening.
        setTimeout(() => void saveCreds().catch(() => undefined), 2_000);
      }
      if (u.connection === 'close') {
        const err = u.lastDisconnect?.error as
          { output?: { statusCode?: number }; message?: string } | undefined;
        emit({ type: 'close', code: err?.output?.statusCode, message: err?.message });
      }
    });
    sock.ev.on('creds.update', () => {
      // Never debounced: a lost credentials write is a lost device.
      void saveCreds()
        .then(() => emit({ type: 'creds' }))
        .catch((err) =>
          this.logger.error({ err: String(err) }, '[NODE] saving credentials failed'),
        );
    });

    return {
      subscribe: (l) => {
        listener = l;
        for (const e of backlog.splice(0)) l(e);
      },
      requestPairingCode: async (phoneDigits) => {
        // The socket must be talking to WhatsApp before it can be asked for a code.
        await Promise.race([
          signalled,
          new Promise((_, rej) =>
            setTimeout(() => rej(new Error('The connection did not start in time.')), 30_000),
          ),
        ]);
        return sock.requestPairingCode(phoneDigits);
      },
      logout: () => sock.logout(),
      end: () => {
        ended = true;
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.end(undefined);
      },
    };
  }

  async deleteSession(orgId: number, deviceId: number): Promise<void> {
    await this.store.deleteAll(orgId, deviceId);
  }

  /** Reference's order: the WhatsApp Web version, then Baileys' own, cached for an hour; none lets the library choose. */
  private async waVersion(): Promise<WAVersion | undefined> {
    if (this.version && Date.now() - this.version.at < VERSION_TTL_MS) return this.version.value;
    let value: WAVersion | undefined;
    try {
      const v = await fetchLatestWaWebVersion({});
      value = v.version as WAVersion;
    } catch {
      try {
        value = (await fetchLatestBaileysVersion()).version as WAVersion;
      } catch {
        value = undefined;
      }
    }
    this.version = { at: Date.now(), value };
    return value;
  }

  /** Credentials and signal keys as encrypted rows (the multi-file auth state of Baileys, in Postgres). */
  private async loadState(orgId: number, deviceId: number) {
    const raw = await this.store.read(orgId, deviceId, 'creds');
    const creds: AuthenticationCreds = raw ? JSON.parse(raw, BufferJSON.reviver) : initAuthCreds();
    const keys: SignalKeyStore = {
      get: async (type, ids) => {
        const found = await this.store.readMany(
          orgId,
          deviceId,
          ids.map((id) => `${type}-${id}`),
        );
        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const value = found.get(`${type}-${id}`);
          if (!value) continue;
          let parsed = JSON.parse(value, BufferJSON.reviver);
          if (type === 'app-state-sync-key') {
            parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
          }
          data[id] = parsed;
        }
        return data;
      },
      set: async (data) => {
        const entries: Array<[string, string | null]> = [];
        for (const category of Object.keys(data) as Array<keyof SignalDataTypeMap>) {
          for (const [id, value] of Object.entries(data[category] ?? {})) {
            entries.push([
              `${category}-${id}`,
              value ? JSON.stringify(value, BufferJSON.replacer) : null,
            ]);
          }
        }
        await this.store.write(orgId, deviceId, entries);
      },
    };
    const saveCreds = () =>
      this.store.write(orgId, deviceId, [['creds', JSON.stringify(creds, BufferJSON.replacer)]]);
    return { creds, keys, saveCreds };
  }
}
