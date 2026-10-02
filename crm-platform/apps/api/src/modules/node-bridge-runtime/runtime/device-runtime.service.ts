import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { DeviceAuthStore } from '../../../infra/providers/node-bridge-runtime/device-auth-store';
import { shortStatus } from './close-policy';
import { DeviceSession, type SessionHost, type StatusReport } from './device-session';
import { deviceStatusOf, statusLabel } from './device-status';
import { COMMAND_TIMEOUT_MS, type DeviceCommand, type DeviceCommandResult } from './device-command';
import type {
  ProxySettings,
  WaSocketFactory,
} from '../../../infra/providers/node-bridge-runtime/socket.port';
import { WA_SOCKET_FACTORY } from '../../../infra/providers/node-bridge-runtime/socket.port';
import { DeviceLease, waKeys } from './wa-redis';
import { DeviceControlService } from './device-control.service';
import { InboundRouter, ReceiptRouter } from './routers';
import {
  UnsupportedSendError,
  type MessageAction,
  type SendCommand,
  type SendContext,
  type SendOutcome,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import type { GroupAction } from '../../../infra/providers/node-bridge-runtime/socket.port';
import { DeviceNotReadyError } from './device-session';
import { senderDigits } from '../outbound/sender-resolver.service';

/** Reference's rule: a session of fewer files than this was never finished or was logged out. */
const HEALTHY_SESSION_ROWS = 3;
/** A device that nobody has touched for this long is no longer connected. */
const STALE_SECONDS = 90;
const TICK_MS = 20_000;
const CODE_TTL_S = 180;
/** The same code is handed back inside this window: asking again mid-entry makes WhatsApp refuse the first one. */
const CODE_REUSE_MS = 120_000;
const QR_WAIT_MS = 30_000;
const POLL_MS = 500;

interface Owned {
  orgId: number;
  deviceId: number;
  session: DeviceSession;
  token: string;
}

interface DeviceRow {
  id: number | string;
  country_code: string | null;
  phone_number: string | null;
  proxy_enabled: boolean;
  proxy_type: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_password: string | null;
}

const key = (orgId: number, deviceId: number) => `${orgId}:${deviceId}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The unofficial engine's runtime, in the worker (TW-NODE-005, 006, 007, 011, 012, 013, 014).
 *
 * Every connected device has one session here, owned through a Redis lease so only one worker holds it. Status goes to the
 * `devices` row and to the outbox; the QR and the pairing code go to Redis, where the API reads them. At boot and on every
 * pass it adopts the devices that have a saved session and no owner (the restore of TW-NODE-007, which is also the failover
 * when another worker dies). On shutdown it closes connections and keeps the sessions, with no unlink (TW-NODE-006).
 */
@Injectable()
export class DeviceRuntimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeviceRuntimeService.name);
  private readonly owned = new Map<string, Owned>();
  private subscriber: Redis | null = null;
  private stopped = false;
  private passes = 0;
  /** Pause between devices when restoring many at once, to spare the CPU (Reference: 2 s). Tests set 0. */
  staggerMs = 2_000;

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly lease: DeviceLease,
    private readonly outbox: OutboxService,
    private readonly store: DeviceAuthStore,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(WA_SOCKET_FACTORY) private readonly factory: WaSocketFactory,
    private readonly inbound: InboundRouter,
    private readonly receipts: ReceiptRouter,
    private readonly control: DeviceControlService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // A send for a device this process owns goes straight to its socket, not through Redis.
    this.control.local = {
      owns: (o, d) => this.owned.has(key(o, d)),
      send: (o, d, c, x) => this.send(o, d, c, x),
      act: (o, d, a) => this.act(o, d, a),
      groups: (o, d, a) => this.groupAction(o, d, a),
    };
    await this.subscribe();
    void this.restore().catch((err) =>
      this.logger.error({ err: String(err) }, '[NODE] restore failed'),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    // Close, do not unlink: the sessions stay so another worker (or this one after a restart) can take them over.
    for (const o of this.owned.values()) {
      o.session.softDisconnect();
      await this.lease.release(o.orgId, o.deviceId, o.token).catch(() => undefined);
    }
    this.owned.clear();
    this.control.local = null;
    this.stopped = true;
    // A connection in subscriber mode cannot QUIT: unsubscribe, then close it, or this worker keeps answering commands.
    await this.subscriber?.unsubscribe().catch(() => undefined);
    this.subscriber?.disconnect();
    this.subscriber = null;
  }

  get ownedCount(): number {
    return this.owned.size;
  }
  isOwned(orgId: number, deviceId: number): boolean {
    return this.owned.has(key(orgId, deviceId));
  }
  isReady(orgId: number, deviceId: number): boolean {
    return this.owned.get(key(orgId, deviceId))?.session.isReady ?? false;
  }

  // --- adopting devices ----------------------------------------------------------------------

  /**
   * Takes over a device: reads its row, takes its lease, and opens its session. `busy` means another worker owns it,
   * `missing` that the row is gone. With `connect: false` the session is built but not opened (a command is about to start it
   * from scratch).
   */
  async adopt(
    orgId: number,
    deviceId: number,
    opts: { connect?: boolean } = {},
  ): Promise<'started' | 'already' | 'busy' | 'missing'> {
    if (this.owned.has(key(orgId, deviceId))) return 'already';
    const dev = await this.loadDevice(orgId, deviceId);
    if (!dev) return 'missing';
    const token = await this.lease.acquire(orgId, deviceId);
    if (!token) return 'busy';

    const host: SessionHost = {
      report: (r) => this.applyStatus(orgId, deviceId, r),
      proxyFor: async () => this.proxyOf((await this.loadDevice(orgId, deviceId)) ?? dev),
      ended: () => void this.drop(orgId, deviceId),
      inbound: async (n, media) => void (await this.inbound.message(orgId, deviceId, n, media)),
      receipt: async (r) => void (await this.receipts.route({ orgId, deviceId }, r)),
      groups: (g) => this.inbound.groups(orgId, deviceId, g),
    };
    const session = new DeviceSession(
      { orgId, deviceId, phoneDigits: senderDigits(dev.country_code, dev.phone_number) },
      this.factory,
      host,
    );
    this.owned.set(key(orgId, deviceId), { orgId, deviceId, session, token });
    if (opts.connect !== false) await session.start();
    return 'started';
  }

  /** Releases a device whose session has ended for good. */
  private async drop(orgId: number, deviceId: number): Promise<void> {
    const o = this.owned.get(key(orgId, deviceId));
    if (!o) return;
    this.owned.delete(key(orgId, deviceId));
    await this.lease.release(orgId, deviceId, o.token).catch(() => undefined);
  }

  /**
   * Opens every device that has a saved session and no owner (TW-NODE-007). A session of fewer than 3 rows is not restored: the
   * phone logged the device out or pairing never finished, and the device is reported Disconnected.
   */
  async restore(): Promise<{ started: number; skipped: number }> {
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT d.org_id, d.id, count(a.id)::int AS n
          FROM devices d JOIN device_auth_state a ON a.org_id = d.org_id AND a.device_id = d.id
         GROUP BY d.org_id, d.id ORDER BY d.org_id, d.id`);
      return res.rows as unknown as Array<{
        org_id: number | string;
        id: number | string;
        n: number;
      }>;
    });
    let started = 0;
    let skipped = 0;
    for (const r of rows) {
      const orgId = Number(r.org_id);
      const deviceId = Number(r.id);
      if (this.owned.has(key(orgId, deviceId))) continue;
      if (r.n < HEALTHY_SESSION_ROWS) {
        skipped++;
        if ((await this.lease.holder(orgId, deviceId)) === null) {
          await this.applyStatus(orgId, deviceId, { status: 'disconnected', progress: 0 });
        }
        continue;
      }
      try {
        if ((await this.adopt(orgId, deviceId)) === 'started') {
          started++;
          if (this.staggerMs > 0) await sleep(this.staggerMs);
        }
      } catch (err) {
        // One device failing must not stop the others.
        this.logger.warn({ orgId, deviceId, err: String(err) }, '[NODE] restoring a device failed');
      }
    }
    if (started + skipped > 0) this.logger.log({ started, skipped }, '[NODE] devices restored');
    return { started, skipped };
  }

  // --- the periodic pass (liveness, TW-NODE-014) ----------------------------------------------

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    try {
      await this.pass();
    } catch (err) {
      this.logger.error({ err: String(err) }, '[NODE] runtime pass failed');
    }
  }

  /** Public for tests. */
  async pass(): Promise<void> {
    this.passes++;
    const alive: Array<[number, number]> = [];
    for (const o of [...this.owned.values()]) {
      // A lease that is no longer ours means another worker has the device: stop at once, never run two sockets.
      if (!(await this.lease.renew(o.orgId, o.deviceId, o.token))) {
        this.logger.warn(
          { orgId: o.orgId, deviceId: o.deviceId },
          '[NODE] lost the device lease, closing',
        );
        o.session.softDisconnect();
        this.owned.delete(key(o.orgId, o.deviceId));
        continue;
      }
      if (o.session.isReady) alive.push([o.orgId, o.deviceId]);
      if (this.passes % 3 === 0) await o.session.tick();
    }
    await this.touch(alive);
    await this.flipStale();
    if (this.passes % 3 === 1) await this.restore();
  }

  /** The device's own worker says it is alive: this is the heartbeat that replaces Reference's bridge-to-Laravel POST. */
  private async touch(devices: Array<[number, number]>): Promise<void> {
    if (devices.length === 0) return;
    await this.db.privileged(async (tx) => {
      for (const [orgId, deviceId] of devices) {
        await tx.execute(
          sql`UPDATE devices SET last_seen_at = now() WHERE org_id = ${orgId} AND id = ${deviceId}`,
        );
      }
    });
  }

  /** A device nobody has touched for 90 s is not connected any more (its worker died without saying so). */
  private async flipStale(): Promise<void> {
    await this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE devices SET status = 'disconnected'
         WHERE status = 'connected' AND last_seen_at < now() - ${`${STALE_SECONDS} seconds`}::interval
        RETURNING org_id, id`);
      for (const r of res.rows as unknown as Array<{
        org_id: number | string;
        id: number | string;
      }>) {
        await this.outbox.emit(tx, {
          aggregateModule: 'devices',
          aggregateId: Number(r.id),
          orgId: Number(r.org_id),
          eventType: 'device.status_changed',
          payload: { status: 'disconnected', label: 'Disconnected', progress: 0 },
        });
      }
    });
  }

  // --- status (TW-NODE-012) -------------------------------------------------------------------

  /** Turns what a session reports into the device row, an outbox event and what the API reads from Redis. */
  async applyStatus(orgId: number, deviceId: number, r: StatusReport): Promise<void> {
    const label = statusLabel(r.status, r.reason);
    const status = deviceStatusOf(label);
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await tx.execute(sql`
        UPDATE devices
           SET status = ${status}, last_seen_at = now(),
               active = active OR ${status === 'connected'}
         WHERE org_id = ${orgId} AND id = ${deviceId}`);
      await this.outbox.emit(tx, {
        aggregateModule: 'devices',
        aggregateId: deviceId,
        orgId,
        eventType: 'device.status_changed',
        payload: { status, label, progress: r.progress },
      });
    });
    const finished = ['open', 'logged_out', 'pair_failed', 'mismatch', 'disconnected'].includes(
      r.status,
    );
    if (r.qr) await this.redis.set(waKeys.qr(orgId, deviceId), r.qr, 'EX', 120);
    if (r.code) {
      await this.redis.set(
        waKeys.code(orgId, deviceId),
        JSON.stringify({ code: r.code, at: Date.now() }),
        'EX',
        CODE_TTL_S,
      );
    }
    if (finished) await this.redis.del(waKeys.qr(orgId, deviceId), waKeys.code(orgId, deviceId));
    await this.redis.set(
      waKeys.status(orgId, deviceId),
      JSON.stringify({ label, status, progress: r.progress, at: Date.now() }),
      'EX',
      300,
    );
    await this.inbound.deviceStatus(orgId, deviceId, {
      status: label,
      connected: status === 'connected',
    });
  }

  /** A media command that left its file in Redis (`bufferKey`) gets the bytes back before the socket sends it. */
  private async withBytes(command: SendCommand): Promise<SendCommand> {
    if (command.type !== 'media' || !command.bufferKey) return command;
    const data = await this.redis.getdelBuffer(command.bufferKey);
    if (!data)
      throw new UnsupportedSendError('The file to send expired before the device took it.');
    const { bufferKey: _gone, ...rest } = command;
    return { ...rest, data };
  }

  /** The proxy Reference's `loadProxy` read at every connect (TW-NODE-013). Null means a direct connection. */
  private proxyOf(dev: DeviceRow): ProxySettings | null {
    if (!dev.proxy_enabled || !dev.proxy_host || !dev.proxy_port) return null;
    return {
      type: dev.proxy_type === 'socks5' ? 'socks5' : 'http',
      host: dev.proxy_host,
      port: Number(dev.proxy_port),
      username: dev.proxy_username,
      password: dev.proxy_password ? this.crypto.decrypt(dev.proxy_password) : null,
    };
  }

  /** What the last connection attempt through the proxy found, kept on the device (TW-NODE-013 rule 2). */
  async recordProxyResult(
    orgId: number,
    deviceId: number,
    r: { ok: boolean; egressIp?: string; error?: string },
  ): Promise<void> {
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      tx.execute(sql`
        UPDATE devices
           SET proxy_status = ${r.ok ? 'ok' : 'unreachable'}, proxy_egress_ip = ${r.egressIp ?? null},
               proxy_checked_at = now()
         WHERE org_id = ${orgId} AND id = ${deviceId}`),
    );
  }

  private async loadDevice(orgId: number, deviceId: number): Promise<DeviceRow | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, country_code, phone_number, proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password
          FROM devices WHERE org_id = ${orgId} AND id = ${deviceId}`);
      return (res.rows[0] as unknown as DeviceRow | undefined) ?? null;
    });
  }

  // --- sending (TW-NODE-022 to 025, 021) -------------------------------------------------------

  /** Sends through a device this worker owns. Throws when it does not, or when the number is not connected. */
  async send(
    orgId: number,
    deviceId: number,
    command: SendCommand,
    context: SendContext,
  ): Promise<SendOutcome> {
    return this.session(orgId, deviceId).send(command, context);
  }

  async act(orgId: number, deviceId: number, action: MessageAction): Promise<void> {
    await this.session(orgId, deviceId).act(action);
  }

  async groupAction(
    orgId: number,
    deviceId: number,
    action: GroupAction,
  ): Promise<DeviceCommandResult> {
    try {
      return {
        ok: true,
        status: 'group',
        result: await this.session(orgId, deviceId).groups(action),
      };
    } catch (err) {
      return failureOf(err);
    }
  }

  private session(orgId: number, deviceId: number): DeviceSession {
    const o = this.owned.get(key(orgId, deviceId));
    if (!o) throw new DeviceNotReadyError();
    return o.session;
  }

  // --- commands from the API (TW-NODE-008, 009, 010) ------------------------------------------

  private async subscribe(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.subscribe(waKeys.commandChannel);
    this.subscriber.on('message', (_channel, message) => {
      void this.onMessage(message);
    });
  }

  private async onMessage(message: string): Promise<void> {
    if (this.stopped) return;
    let cmd: DeviceCommand;
    try {
      cmd = JSON.parse(message) as DeviceCommand;
    } catch {
      return;
    }
    try {
      const result = await this.handle(cmd);
      // Only the worker that owns the device answers; the others stay silent.
      if (result)
        await this.redis.set(waKeys.commandResult(cmd.id), JSON.stringify(result), 'EX', 60);
    } catch (err) {
      this.logger.error({ cmd: cmd.type, err: String(err) }, '[NODE] device command failed');
      await this.redis.set(
        waKeys.commandResult(cmd.id),
        JSON.stringify({
          ok: false,
          status: 'error',
          message: 'The connection could not be started.',
        }),
        'EX',
        60,
      );
    }
  }

  /** Public for tests. Returns null when this worker is not the one to answer. */
  async handle(cmd: DeviceCommand): Promise<DeviceCommandResult | null> {
    const { orgId, deviceId } = cmd;
    if (cmd.type === 'send' || cmd.type === 'act' || cmd.type === 'group') {
      // Only the worker that owns the device can send through it; the others stay silent.
      if (!this.owned.has(key(orgId, deviceId))) return null;
      try {
        if (cmd.type === 'send') {
          const r = await this.send(
            orgId,
            deviceId,
            await this.withBytes(cmd.command),
            cmd.context,
          );
          return { ok: true, status: 'sent', providerMessageId: r.providerMessageId };
        }
        if (cmd.type === 'act') {
          await this.act(orgId, deviceId, cmd.action);
          return { ok: true, status: 'acted' };
        }
        return await this.groupAction(orgId, deviceId, cmd.action);
      } catch (err) {
        return failureOf(err);
      }
    }
    if (!this.owned.has(key(orgId, deviceId))) {
      const adopted = await this.adopt(orgId, deviceId, { connect: false });
      if (adopted === 'busy') return null; // another worker owns it and will answer
      if (adopted === 'missing')
        return { ok: false, status: 'not_found', message: 'Device not found.' };
    }
    const o = this.owned.get(key(orgId, deviceId))!;
    switch (cmd.type) {
      case 'qr':
        return this.qr(o);
      case 'code':
        return this.code(o);
      case 'terminate':
        return this.terminate(o);
    }
    return null;
  }

  private async qr(o: Owned): Promise<DeviceCommandResult> {
    if (o.session.isReady) {
      return { ok: true, status: 'connected', qr: null, message: 'Client already ready' };
    }
    // One attempt at a time per device: a second call inside a minute is refused (Reference: 429).
    const lock = await this.redis.set(waKeys.initLock(o.orgId, o.deviceId), '1', 'EX', 60, 'NX');
    if (lock !== 'OK') {
      return {
        ok: false,
        status: 'busy',
        message: 'Another connection attempt is already in progress.',
      };
    }
    try {
      await this.redis.del(waKeys.qr(o.orgId, o.deviceId));
      await o.session.restartFresh();
      const until = Date.now() + QR_WAIT_MS;
      while (Date.now() < until) {
        if (o.session.isReady)
          return { ok: true, status: 'connected', qr: null, message: 'Client already ready' };
        const qr = await this.redis.get(waKeys.qr(o.orgId, o.deviceId));
        if (qr) return { ok: true, status: 'qr_ready', qr };
        if (o.session.isEnded) break;
        await sleep(POLL_MS);
      }
      return { ok: false, status: 'timeout', message: 'No QR code was produced in time.' };
    } finally {
      await this.redis.del(waKeys.initLock(o.orgId, o.deviceId));
    }
  }

  private async code(o: Owned): Promise<DeviceCommandResult> {
    const { orgId, deviceId } = o;
    const phone = (await this.loadDevice(orgId, deviceId))?.phone_number ?? '';
    const digits = senderDigits(
      (await this.loadDevice(orgId, deviceId))?.country_code ?? null,
      phone,
    );
    if (digits.length < 8) {
      const message = 'Phone number must include the country code.';
      await this.applyStatus(orgId, deviceId, {
        status: 'code_failed',
        progress: 0,
        reason: shortStatus(`Pairing failed: ${message}`),
      });
      return { ok: false, status: 'error', message };
    }
    if (!o.session.isReady) {
      const prior = await this.redis.get(waKeys.code(orgId, deviceId));
      if (prior) {
        const p = JSON.parse(prior) as { code: string; at: number };
        if (Date.now() - p.at < CODE_REUSE_MS) {
          return { ok: true, status: 'code_ready', code: p.code, expiresIn: CODE_TTL_S };
        }
      }
    } else {
      return { ok: false, status: 'error', message: 'This device is already linked.' };
    }
    try {
      const code = await Promise.race([
        o.session.pairingCode(),
        new Promise<never>((_, rej) =>
          setTimeout(
            () => rej(new Error('No pairing code was produced in time.')),
            COMMAND_TIMEOUT_MS.code - 5_000,
          ),
        ),
      ]);
      return { ok: true, status: 'code_ready', code, expiresIn: CODE_TTL_S };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pairing failed.';
      await this.applyStatus(orgId, deviceId, {
        status: 'code_failed',
        progress: 0,
        reason: shortStatus(`Pairing failed: ${message}`),
      });
      return { ok: false, status: 'error', message };
    }
  }

  /** Unlink from the phone and forget the session. The product's "Disconnect"; Reference's `terminate-client`. */
  private async terminate(o: Owned): Promise<DeviceCommandResult> {
    await o.session.logout();
    await this.applyStatus(o.orgId, o.deviceId, { status: 'disconnected', progress: 0 });
    return { ok: true, status: 'terminated' };
  }
}

/** What a failed send or action becomes for the caller: the reason, in words the user can act on. */
function failureOf(err: unknown): DeviceCommandResult {
  if (err instanceof DeviceNotReadyError)
    return { ok: false, status: 'not_ready', message: err.message };
  if (err instanceof UnsupportedSendError)
    return { ok: false, status: 'unsupported', message: err.message };
  return {
    ok: false,
    status: 'error',
    message: err instanceof Error ? err.message : 'The message could not be sent.',
  };
}
