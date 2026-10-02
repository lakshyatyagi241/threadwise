import { decideClose, isMismatch, QR_MIN_GAP_MS, QR_STALL_MS, shortStatus } from './close-policy';
import type { RuntimeStatus } from './device-status';
import type {
  GroupSnapshot,
  ReceiptUpdate,
} from '../../../infra/providers/node-bridge-runtime/inbound.port';
import type { Normalized } from '../../../infra/providers/node-bridge-runtime/inbound-normalizer';
import type {
  MessageAction,
  SendCommand,
  SendContext,
  SendOutcome,
} from '../../../infra/providers/node-bridge-runtime/outbound.port';
import type {
  GroupAction,
  GroupResult,
  ProxySettings,
  SocketEvent,
  WaSocket,
  WaSocketFactory,
} from '../../../infra/providers/node-bridge-runtime/socket.port';

/** Timers and dice, injected so the state machine can be driven by a fake clock. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
  random: () => Math.random(),
};

export interface StatusReport {
  status: RuntimeStatus;
  progress: number;
  /** Set for `qr`; the screens render it. */
  qr?: string;
  /** Set for `code`. */
  code?: string;
  /** The exact label for `pair_failed` (`Pair failed: connection replaced`). */
  reason?: string;
}

/** What a session needs from the runtime around it. */
export interface SessionHost {
  report(report: StatusReport): Promise<void>;
  /** The proxy to use for the next connection; null for direct. Read at every start, as WaDesk did. */
  proxyFor(): Promise<ProxySettings | null>;
  /** This session has ended for good (logout, failed pairing, mismatch): the runtime drops it and releases the device. */
  ended(): void;
  /** What the socket delivered (WD-NODE-016, 018, 020, 021). The runtime hands each to whoever consumes it. */
  inbound?(message: Normalized): Promise<void>;
  receipt?(receipt: ReceiptUpdate): Promise<void>;
  groups?(groups: GroupSnapshot[]): Promise<void>;
}

/** A send was asked of a device that is not connected (WaDesk: HTTP 503 `Sender device is not connected.`). */
export class DeviceNotReadyError extends Error {
  constructor() {
    super('Sender device is not connected.');
  }
}

export interface SessionIds {
  orgId: number;
  deviceId: number;
  phoneDigits: string;
}

const CONNECT_RETRY_MS = 5_000;
const MAX_CONNECT_RETRIES = 50;
const QR_WATCH_MS = 5_000;

/**
 * One device's connection (WD-NODE-011): the state machine behind "stay connected until the phone says logout".
 *
 * Events from a socket that has been replaced or ended are ignored (a generation counter), so two closes arriving back to
 * back cannot arm two reconnects. Every outcome that matters is a status report; the runtime turns them into rows and events.
 */
export class DeviceSession {
  private sock: WaSocket | null = null;
  private generation = 0;
  private connecting = false;
  private connected = false;
  private everOpened = false;
  private shouldStayConnected = true;
  private shuttingDown = false;
  private retries = 0;
  private connectFailures = 0;
  private reconnectTimer: unknown = null;
  private qrWatch: unknown = null;
  private qrFirstShownAt: number | null = null;
  private lastQrAt: number | null = null;
  private scanned = false;
  private nextStatus: { status: RuntimeStatus; progress: number } | null = null;
  /** Events are applied one after another, so a slow report can never land after a later one. */
  private events: Promise<void> = Promise.resolve();
  /** How long a send waits for the socket to come back (the post-pairing restart race), as WaDesk's 8 s. */
  readyWaitMs = 8_000;

  constructor(
    private readonly ids: SessionIds,
    private readonly factory: WaSocketFactory,
    private readonly host: SessionHost,
    private readonly clock: Clock = systemClock,
  ) {}

  get isReady(): boolean {
    return this.connected;
  }
  get isEnded(): boolean {
    return !this.shouldStayConnected;
  }
  /** A first pairing is in progress: a QR is showing and the device has never been open. */
  get isPairing(): boolean {
    return !this.everOpened && this.qrFirstShownAt !== null;
  }

  /** Opens the connection. Safe to call again: it does nothing while connecting or connected. */
  async start(): Promise<void> {
    if (this.connecting || this.connected || this.shuttingDown || !this.shouldStayConnected) return;
    this.connecting = true;
    const generation = ++this.generation;
    try {
      const proxy = await this.host.proxyFor();
      const sock = await this.factory.create({ ...this.ids, proxy });
      if (generation !== this.generation) {
        sock.end();
        return;
      }
      this.sock = sock;
      sock.subscribe((e) => {
        this.events = this.events.then(() => this.handle(generation, e)).catch(() => undefined);
      });
    } catch {
      // The proxy could not be reached or the socket could not be built: try again shortly, without a status of its own.
      this.connecting = false;
      if (
        this.shouldStayConnected &&
        !this.shuttingDown &&
        this.connectFailures++ < MAX_CONNECT_RETRIES
      ) {
        this.arm(CONNECT_RETRY_MS);
      }
    }
  }

  /** Starts over from a clean socket: used before a new QR or pairing code is wanted (WaDesk `resetForFreshAuth`). */
  async restartFresh(): Promise<void> {
    const old = this.sock;
    this.disposeSocket();
    old?.end();
    this.clearTimers();
    this.qrFirstShownAt = null;
    this.lastQrAt = null;
    this.scanned = false;
    this.connecting = false;
    this.connected = false;
    this.shouldStayConnected = true;
    await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
    await this.start();
  }

  /** The 8-character pairing code (WD-NODE-009). Needs a socket that has started connecting. */
  async pairingCode(): Promise<string> {
    await this.restartFresh();
    const sock = this.sock;
    if (!sock) throw new Error('The connection could not be started.');
    const code = await sock.requestPairingCode(this.ids.phoneDigits);
    await this.host.report({ status: 'code', progress: 25, code });
    return code;
  }

  /** Sends one message through this device's socket. Waits up to `readyWaitMs` for it to be connected, then refuses. */
  async send(command: SendCommand, context: SendContext): Promise<SendOutcome> {
    return (await this.readySocket()).send(command, context);
  }

  async act(action: MessageAction): Promise<void> {
    await (await this.readySocket()).act(action);
  }

  async groups(action: GroupAction): Promise<GroupResult> {
    return (await this.readySocket()).groups(action);
  }

  private async readySocket(): Promise<WaSocket> {
    const until = this.clock.now() + this.readyWaitMs;
    for (;;) {
      if (this.connected && this.sock) return this.sock;
      if (this.clock.now() >= until || !this.shouldStayConnected || this.shuttingDown) {
        throw new DeviceNotReadyError();
      }
      await new Promise<void>((r) => setTimeout(r, 250));
    }
  }

  /** The user unlinked the device: stop for good, unlink on the phone, forget the session. */
  async logout(): Promise<void> {
    this.shouldStayConnected = false;
    this.clearTimers();
    const sock = this.sock;
    this.disposeSocket();
    try {
      await sock?.logout();
    } catch {
      /* already unlinked, or the socket was down: the session is deleted either way */
    }
    await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
    this.connected = false;
    this.host.ended();
  }

  /** The process is stopping: close the connection, keep the session, do not unlink (WD-NODE-006). */
  softDisconnect(): void {
    this.shuttingDown = true;
    this.clearTimers();
    const sock = this.sock;
    this.disposeSocket();
    sock?.end();
    this.connected = false;
  }

  /**
   * The health watchdog, called about once a minute by the runtime (not a timer per device): a session that is meant to stay
   * connected but is neither connecting, connected, waiting to reconnect, nor in the middle of a first pairing is started again.
   */
  async tick(): Promise<void> {
    if (!this.shouldStayConnected || this.shuttingDown) return;
    if (this.connecting || this.connected || this.reconnectTimer !== null || this.isPairing) return;
    await this.start();
  }

  // --- events --------------------------------------------------------------------------------

  private async handle(generation: number, e: SocketEvent): Promise<void> {
    if (generation !== this.generation) return;
    switch (e.type) {
      case 'connecting': {
        const next = this.nextStatus ?? { status: 'connecting' as const, progress: 25 };
        this.nextStatus = null;
        await this.host.report(next);
        return;
      }
      case 'qr':
        return this.onQr(e.qr);
      case 'creds':
        // The scan went through: the restart that follows must not be mistaken for a stalled pairing.
        this.scanned = true;
        this.stopQrWatch();
        return;
      case 'open':
        return this.onOpen(e.linkedId);
      case 'close':
        return this.onClose(e.code, e.message);
      case 'message':
        return this.host.inbound?.(e.normalized);
      case 'receipt':
        return this.host.receipt?.(e.receipt);
      case 'groups':
        return this.host.groups?.(e.groups);
    }
  }

  private async onQr(qr: string): Promise<void> {
    const now = this.clock.now();
    if (this.lastQrAt !== null && now - this.lastQrAt < QR_MIN_GAP_MS) return; // a rotation of the same attempt
    this.lastQrAt = now;
    if (this.qrFirstShownAt === null) {
      this.qrFirstShownAt = now;
      this.watchQr();
    }
    await this.host.report({ status: 'qr', progress: 25, qr });
  }

  private watchQr(): void {
    this.stopQrWatch();
    this.qrWatch = this.clock.setTimeout(() => void this.qrTick(), QR_WATCH_MS);
  }

  private async qrTick(): Promise<void> {
    this.qrWatch = null;
    if (
      this.everOpened ||
      this.scanned ||
      this.qrFirstShownAt === null ||
      !this.shouldStayConnected
    )
      return;
    if (this.clock.now() - this.qrFirstShownAt >= QR_STALL_MS) {
      await this.abandonPairing('Pair failed: QR timeout');
      return;
    }
    this.watchQr();
  }

  private async onOpen(linkedId: string | undefined): Promise<void> {
    this.connecting = false;
    if (isMismatch(linkedId, this.ids.phoneDigits)) {
      // Scanned with a different phone than the one this device was made for.
      this.shouldStayConnected = false;
      this.clearTimers();
      const sock = this.sock;
      this.disposeSocket();
      try {
        await sock?.logout();
      } catch {
        /* the session is deleted anyway */
      }
      await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
      await this.host.report({ status: 'mismatch', progress: 0 });
      this.host.ended();
      return;
    }
    this.connected = true;
    this.everOpened = true;
    this.retries = 0;
    this.connectFailures = 0;
    this.qrFirstShownAt = null;
    this.stopQrWatch();
    this.cancelReconnect();
    await this.host.report({ status: 'open', progress: 100 });
  }

  private async onClose(code: number | undefined, message: string | undefined): Promise<void> {
    this.connected = false;
    this.connecting = false;
    this.sock = null;
    const d = decideClose({
      code,
      message,
      everOpened: this.everOpened,
      shuttingDown: this.shuttingDown,
      retries: this.retries,
      random: () => this.clock.random(),
    });
    switch (d.action) {
      case 'ignore':
        return;
      case 'abort-pair':
        await this.abandonPairing(d.status);
        return;
      case 'logged-out':
        this.shouldStayConnected = false;
        this.clearTimers();
        await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
        await this.host.report({ status: 'logged_out', progress: 0 });
        this.host.ended();
        return;
      case 'reset-session':
        await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
        this.retries++;
        this.arm(d.delayMs);
        return;
      case 'reconnect':
        this.nextStatus = {
          status: d.status.label === 'Syncing data' ? 'syncing' : 'reconnecting',
          progress: d.status.progress,
        };
        this.retries++;
        this.arm(d.delayMs);
        return;
    }
  }

  private async abandonPairing(reason: string): Promise<void> {
    this.shouldStayConnected = false;
    this.clearTimers();
    const sock = this.sock;
    this.disposeSocket();
    sock?.end();
    await this.factory.deleteSession(this.ids.orgId, this.ids.deviceId);
    await this.host.report({ status: 'pair_failed', progress: 0, reason: shortStatus(reason) });
    this.host.ended();
  }

  // --- timers --------------------------------------------------------------------------------

  /** One reconnect at a time: a close that arrives while one is already waiting replaces it. */
  private arm(delayMs: number): void {
    this.cancelReconnect();
    this.reconnectTimer = this.clock.setTimeout(() => {
      this.reconnectTimer = null;
      void this.start();
    }, delayMs);
  }
  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) this.clock.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  private stopQrWatch(): void {
    if (this.qrWatch !== null) this.clock.clearTimeout(this.qrWatch);
    this.qrWatch = null;
  }
  private clearTimers(): void {
    this.cancelReconnect();
    this.stopQrWatch();
  }
  /** Detaches the current socket so nothing it says reaches this session any more. */
  private disposeSocket(): void {
    this.generation++;
    this.sock = null;
  }
}
