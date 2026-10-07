import { describe, expect, it } from 'vitest';
import {
  DeviceSession,
  type Clock,
  type SessionHost,
  type StatusReport,
} from '../../../src/modules/node-bridge-runtime/runtime/device-session';
import type {
  ProxySettings,
  SocketEvent,
  SocketTarget,
  WaSocket,
  WaSocketFactory,
} from '../../../src/infra/providers/node-bridge-runtime/socket.port';

/** A clock the test turns by hand. */
class FakeClock implements Clock {
  t = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  roll = 0;
  now = () => this.t;
  random = () => this.roll;
  setTimeout(fn: () => void, ms: number) {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers.delete(h as number);
  }
  get pending() {
    return this.timers.size;
  }
  /** Moves time forward, firing timers in order (and any they arm on the way). */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await flush();
    }
    this.t = end;
  }
}
const flush = () => new Promise<void>((r) => setImmediate(r));

class FakeSocket implements WaSocket {
  listener: ((e: SocketEvent) => void) | null = null;
  ended = false;
  loggedOut = false;
  pairingFor: string | null = null;
  subscribe(l: (e: SocketEvent) => void) {
    this.listener = l;
  }
  async requestPairingCode(digits: string) {
    this.pairingFor = digits;
    return 'ABCD1234';
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
  async send() {
    return { providerMessageId: 'wamid.unit' };
  }
  async act() {
    return undefined;
  }
  async groups() {
    return { ok: true } as const;
  }
  emit(e: SocketEvent) {
    this.listener?.(e);
  }
}

class FakeFactory implements WaSocketFactory {
  sockets: FakeSocket[] = [];
  targets: SocketTarget[] = [];
  deleted = 0;
  failNext = 0;
  async create(target: SocketTarget) {
    this.targets.push(target);
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('proxy unreachable');
    }
    const s = new FakeSocket();
    this.sockets.push(s);
    return s;
  }
  async deleteSession() {
    this.deleted++;
  }
  get last() {
    return this.sockets[this.sockets.length - 1]!;
  }
}

function setup(over: { proxy?: ProxySettings | null } = {}) {
  const clock = new FakeClock();
  const factory = new FakeFactory();
  const reports: StatusReport[] = [];
  let ended = 0;
  const host: SessionHost = {
    report: async (r) => void reports.push(r),
    proxyFor: async () => over.proxy ?? null,
    ended: () => void ended++,
  };
  const session = new DeviceSession(
    { orgId: 1, deviceId: 7, phoneDigits: '919876543210' },
    factory,
    host,
    clock,
  );
  return {
    clock,
    factory,
    reports,
    session,
    get ended() {
      return ended;
    },
    statuses: () => reports.map((r) => `${r.status}:${r.progress}`),
  };
}
const MINE = '919876543210:3@s.whatsapp.net';

async function opened(x: ReturnType<typeof setup>) {
  await x.session.start();
  await flush();
  x.factory.last.emit({ type: 'connecting' });
  x.factory.last.emit({ type: 'open', linkedId: MINE });
  await flush();
}

describe('connecting and staying connected (WD-NODE-011)', () => {
  it('reports Connecting then Ready, and is ready', async () => {
    const x = setup();
    await opened(x);
    expect(x.statuses()).toEqual(['connecting:25', 'open:100']);
    expect(x.session.isReady).toBe(true);
  });

  it('start is a no-op while connecting or connected', async () => {
    const x = setup();
    await x.session.start();
    await x.session.start();
    expect(x.factory.sockets).toHaveLength(1);
  });

  it('the network drops for 10 minutes: it keeps retrying, waits at most about 30 s, and comes back to Ready by itself', async () => {
    const x = setup();
    await opened(x);
    const gaps: number[] = [];
    for (let i = 0; i < 30; i++) {
      const before = x.clock.t;
      x.factory.last.emit({ type: 'close', code: 428 });
      await flush();
      // wait for the reconnect timer, whatever it is
      while (x.factory.sockets.length < i + 2) await x.clock.advance(500);
      gaps.push(x.clock.t - before);
    }
    expect(Math.max(...gaps)).toBeLessThanOrEqual(30_500);
    expect(gaps[gaps.length - 1]).toBeGreaterThanOrEqual(29_000); // settled at the cap
    x.factory.last.emit({ type: 'connecting' });
    x.factory.last.emit({ type: 'open', linkedId: MINE });
    await flush();
    expect(x.session.isReady).toBe(true);
    expect(x.statuses().at(-1)).toBe('open:100');
    expect(x.ended).toBe(0);
  });

  it('retries restart from the short delay after a successful open', async () => {
    const x = setup();
    await opened(x);
    for (let i = 0; i < 4; i++) {
      x.factory.last.emit({ type: 'close', code: 428 });
      await flush();
      await x.clock.advance(30_000);
    }
    x.factory.last.emit({ type: 'open', linkedId: MINE });
    await flush();
    const n = x.factory.sockets.length;
    x.factory.last.emit({ type: 'close', code: 428 });
    await flush();
    await x.clock.advance(4_000); // base for 428 with zero retries and zero jitter
    expect(x.factory.sockets).toHaveLength(n + 1);
  });

  it('two closes back to back arm one reconnect, not two', async () => {
    const x = setup();
    await opened(x);
    const sock = x.factory.last;
    sock.emit({ type: 'close', code: 428 });
    sock.emit({ type: 'close', code: 428 });
    await flush();
    await x.clock.advance(60_000);
    expect(x.factory.sockets).toHaveLength(2);
  });

  it('a drop reports "Reconnecting" on the next connecting, and a post-pairing restart "Syncing data"', async () => {
    const x = setup();
    await opened(x);
    x.factory.last.emit({ type: 'close', code: 428 });
    await flush();
    await x.clock.advance(30_000);
    x.factory.last.emit({ type: 'connecting' });
    await flush();
    expect(x.statuses().at(-1)).toBe('reconnecting:50');
    x.factory.last.emit({ type: 'close', code: 515 });
    await flush();
    await x.clock.advance(30_000);
    x.factory.last.emit({ type: 'connecting' });
    await flush();
    expect(x.statuses().at(-1)).toBe('syncing:75');
  });
});

describe('the phone unlinks the device', () => {
  it('401 after it was open: no reconnect, session deleted, Logged Out, the runtime told', async () => {
    const x = setup();
    await opened(x);
    x.factory.last.emit({ type: 'close', code: 401 });
    await flush();
    expect(x.factory.deleted).toBe(1);
    expect(x.statuses().at(-1)).toBe('logged_out:0');
    // The close code is kept as the reason (spec R8): an unlink is the person removing the link.
    expect(x.reports.at(-1)?.stateReason).toBe('unlinked_on_phone');
    expect(x.ended).toBe(1);
    await x.clock.advance(120_000);
    expect(x.factory.sockets).toHaveLength(1);
    expect(x.session.isEnded).toBe(true);
  });

  it('403 is the same', async () => {
    const x = setup();
    await opened(x);
    x.factory.last.emit({ type: 'close', code: 403 });
    await flush();
    expect(x.statuses().at(-1)).toBe('logged_out:0');
    // A refusal can mean a restriction: it is reported as `forbidden`, never as a ban (we cannot tell).
    expect(x.reports.at(-1)?.stateReason).toBe('forbidden');
  });

  it('a corrupt session (500) is wiped and the device connects again', async () => {
    const x = setup();
    await opened(x);
    x.factory.last.emit({ type: 'close', code: 500 });
    await flush();
    expect(x.factory.deleted).toBe(1);
    await x.clock.advance(30_000);
    expect(x.factory.sockets).toHaveLength(2);
    expect(x.ended).toBe(0);
  });
});

describe('pairing with a QR (WD-NODE-008, 011 rule 5)', () => {
  it('reports the first QR, ignores rotations within 5 s, reports later ones', async () => {
    const x = setup();
    await x.session.start();
    await flush();
    const s = x.factory.last;
    s.emit({ type: 'qr', qr: 'QR-1' });
    await flush();
    await x.clock.advance(2_000);
    s.emit({ type: 'qr', qr: 'QR-2' });
    await flush();
    await x.clock.advance(4_000);
    s.emit({ type: 'qr', qr: 'QR-3' });
    await flush();
    expect(x.reports.filter((r) => r.status === 'qr').map((r) => r.qr)).toEqual(['QR-1', 'QR-3']);
    expect(x.session.isPairing).toBe(true);
  });

  it('a QR that is never scanned: after 90 s "Pair failed: QR timeout", session deleted, not retried', async () => {
    const x = setup();
    await x.session.start();
    await flush();
    x.factory.last.emit({ type: 'qr', qr: 'QR-1' });
    await flush();
    for (let t = 6; t < 90; t += 6) {
      await x.clock.advance(6_000);
      x.factory.last.emit({ type: 'qr', qr: `QR-${t}` }); // rotations do not reset the 90 s clock
      await flush();
    }
    expect(x.ended).toBe(0);
    await x.clock.advance(12_000);
    expect(x.statuses().at(-1)).toBe('pair_failed:0');
    expect(x.reports.at(-1)!.reason).toBe('Pair failed: QR timeout');
    expect(x.factory.deleted).toBe(1);
    expect(x.ended).toBe(1);
    expect(x.factory.last.ended).toBe(true);
  });

  it('the scan going through (credentials saved) stops the stall clock, so the restart after it survives', async () => {
    const x = setup();
    await x.session.start();
    await flush();
    x.factory.last.emit({ type: 'qr', qr: 'QR-1' });
    await flush();
    x.factory.last.emit({ type: 'creds' });
    await flush();
    x.factory.last.emit({ type: 'close', code: 515 });
    await flush();
    await x.clock.advance(120_000);
    expect(x.ended).toBe(0);
    expect(x.factory.sockets.length).toBeGreaterThanOrEqual(2);
    x.factory.last.emit({ type: 'open', linkedId: MINE });
    await flush();
    expect(x.session.isReady).toBe(true);
  });

  it('a first pairing that closes before it ever opened fails with the reason', async () => {
    const x = setup();
    await x.session.start();
    await flush();
    x.factory.last.emit({ type: 'qr', qr: 'QR-1' });
    x.factory.last.emit({ type: 'close', code: 440 });
    await flush();
    expect(x.reports.at(-1)).toMatchObject({
      status: 'pair_failed',
      reason: 'Pair failed: connection replaced',
    });
    expect(x.ended).toBe(1);
    await x.clock.advance(120_000);
    expect(x.factory.sockets).toHaveLength(1);
  });

  it('scanned with a different phone: Mismatch, logged out, session deleted', async () => {
    const x = setup();
    await x.session.start();
    await flush();
    x.factory.last.emit({ type: 'open', linkedId: '911111111111:2@s.whatsapp.net' });
    await flush();
    expect(x.statuses().at(-1)).toBe('mismatch:0');
    expect(x.factory.sockets[0]!.loggedOut).toBe(true);
    expect(x.factory.deleted).toBe(1);
    expect(x.ended).toBe(1);
    expect(x.session.isReady).toBe(false);
  });
});

describe('pairing with a code (WD-NODE-009)', () => {
  it('starts a fresh socket, asks for the code for this phone, and reports it', async () => {
    const x = setup();
    const code = await x.session.pairingCode();
    expect(code).toBe('ABCD1234');
    expect(x.factory.last.pairingFor).toBe('919876543210');
    expect(x.factory.deleted).toBe(1); // any old session is gone first
    expect(x.reports.at(-1)).toMatchObject({ status: 'code', code: 'ABCD1234' });
  });
});

describe('shutdown (WD-NODE-006)', () => {
  it('closes the connection but never unlinks or deletes the session, and ignores what the socket says after', async () => {
    const x = setup();
    await opened(x);
    const sock = x.factory.last;
    x.session.softDisconnect();
    expect(sock.ended).toBe(true);
    expect(sock.loggedOut).toBe(false);
    expect(x.factory.deleted).toBe(0);
    sock.emit({ type: 'close', code: 401 });
    await flush();
    await x.clock.advance(120_000);
    expect(x.factory.sockets).toHaveLength(1);
    expect(x.ended).toBe(0);
  });

  it('a user logout unlinks, deletes and ends', async () => {
    const x = setup();
    await opened(x);
    const sock = x.factory.last;
    await x.session.logout();
    expect(sock.loggedOut).toBe(true);
    expect(x.factory.deleted).toBe(1);
    expect(x.ended).toBe(1);
  });
});

describe('a connection that cannot be built (WD-NODE-011 rule 11, 013 fail-closed)', () => {
  it('is retried every 5 s without a status, up to 50 times, and then left to the watchdog', async () => {
    const x = setup();
    x.factory.failNext = 1000;
    await x.session.start();
    await flush();
    await x.clock.advance(5_000 * 51);
    expect(x.factory.targets.length).toBe(51); // the first try and 50 retries
    expect(x.reports).toHaveLength(0);
    expect(x.factory.sockets).toHaveLength(0); // never a socket without the proxy
    expect(x.clock.pending).toBe(0);
  });

  it('succeeds as soon as the proxy comes back', async () => {
    const x = setup();
    x.factory.failNext = 2;
    await x.session.start();
    await flush();
    await x.clock.advance(11_000);
    expect(x.factory.sockets).toHaveLength(1);
  });

  it('passes the device proxy to every connection', async () => {
    const proxy: ProxySettings = {
      type: 'socks5',
      host: 'p.test',
      port: 1080,
      username: 'u',
      password: 'p',
    };
    const x = setup({ proxy });
    await x.session.start();
    await flush();
    expect(x.factory.targets[0]!.proxy).toEqual(proxy);
  });
});

describe('the health watchdog (WD-NODE-011 rule 9)', () => {
  it('starts a session that should be connected but is idle', async () => {
    const x = setup();
    x.factory.failNext = 1000;
    await x.session.start();
    await flush();
    await x.clock.advance(5_000 * 60); // retries exhausted
    x.factory.failNext = 0;
    await x.session.tick();
    await flush();
    expect(x.factory.sockets).toHaveLength(1);
  });

  it('leaves alone a session that is connected, waiting to reconnect, pairing, ended or shutting down', async () => {
    const connected = setup();
    await opened(connected);
    await connected.session.tick();
    expect(connected.factory.sockets).toHaveLength(1);

    const waiting = setup();
    await opened(waiting);
    waiting.factory.last.emit({ type: 'close', code: 428 });
    await flush();
    await waiting.session.tick();
    expect(waiting.factory.sockets).toHaveLength(1);

    const pairing = setup();
    await pairing.session.start();
    await flush();
    pairing.factory.last.emit({ type: 'qr', qr: 'QR-1' });
    pairing.factory.last.emit({ type: 'close', code: 515 });
    await flush();
    await pairing.session.tick();
    expect(pairing.session.isPairing).toBe(true);

    const gone = setup();
    await opened(gone);
    await gone.session.logout();
    await gone.session.tick();
    expect(gone.factory.sockets).toHaveLength(1);

    const down = setup();
    await opened(down);
    down.session.softDisconnect();
    await down.session.tick();
    expect(down.factory.sockets).toHaveLength(1);
  });
});

describe('a replaced socket is deaf (no ghost events)', () => {
  it('events from the socket before a fresh start do not reach the session', async () => {
    const x = setup();
    await opened(x);
    const old = x.factory.last;
    await x.session.restartFresh();
    old.emit({ type: 'close', code: 401 });
    await flush();
    expect(x.ended).toBe(0);
    expect(old.ended).toBe(true);
  });
});
