import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { race, sleep, statuses } from './support';

/**
 * QA Sheet3 #15, CC-IDEM-03: Redis goes away while requests are running. A relay (a TCP proxy this test owns) sits between the app and
 * its own private Redis container; "outage" is the relay refusing and dropping every connection, "recovery" is the relay listening
 * again. No shared container is touched.
 *
 * Documented behaviour (ADR 0029, section 4): a route with `@Idempotent()` fails closed when Redis is down: the reservation fails, the
 * request answers 5xx, and the handler never runs, so nothing is created without protection. After recovery the same key works and a
 * retry makes exactly one row.
 */
class Relay {
  private server?: net.Server;
  private sockets = new Set<net.Socket>();
  constructor(
    private readonly target: { host: string; port: number },
    readonly port: number,
  ) {}
  static async open(target: { host: string; port: number }): Promise<Relay> {
    // Reserve a free port first, so the relay can listen on the same one again after an outage.
    const probe = net.createServer();
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
    const port = (probe.address() as net.AddressInfo).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const relay = new Relay(target, port);
    await relay.up();
    return relay;
  }
  async up(): Promise<void> {
    this.server = net.createServer((client) => {
      const upstream = net.connect(this.target.port, this.target.host);
      this.sockets.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      for (const s of [client, upstream]) {
        s.on('error', () => s.destroy());
        s.on('close', () => this.sockets.delete(s));
      }
    });
    await new Promise<void>((r) => this.server!.listen(this.port, '127.0.0.1', r));
  }
  async down(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((r) => this.server!.close(() => r()));
  }
}

let h: Harness;
let api: Api;
let relay: Relay;
beforeAll(async () => {
  h = await startHarness({
    redisUrl: async (real) => {
      const u = new URL(real);
      expect(Number(u.port), 'the relay must never point at the shared Redis').not.toBe(56379);
      relay = await Relay.open({ host: u.hostname, port: Number(u.port) });
      return `redis://127.0.0.1:${relay.port}`;
    },
  });
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
  await relay?.down().catch(() => undefined);
});

const rows = async (t: Tenant) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM companies WHERE org_id = $1`, [t.orgId]))
      .rows[0].n,
  );
const create = (t: Tenant, key: string, name: string) =>
  api.as(t.admin).post('/v2/companies').set('Idempotency-Key', key).send({ name });

describe('CC-IDEM-03 Redis down and back during parallel creates', () => {
  it('during the outage 6 creates at once all fail closed (5xx) and create nothing; after recovery the same keys make exactly one row each', async () => {
    const t = await api.signup('rdo');
    // Sign in first: the session is checked in Redis, and the point of this test is the idempotency reservation, not login.
    const warm = await create(t, 'warm-up', 'Warm');
    expect(warm.status, JSON.stringify(warm.body)).toBe(201);
    const before = await rows(t);

    await relay.down();
    let down: Array<{ status: number }> = [];
    try {
      down = await race(6, (i) => create(t, `out-${i}`, `During outage ${i}`), 30);
    } finally {
      await relay.up();
    }
    // Fail closed: never a 2xx. (The status may be 5xx from the idempotency reservation or 401/503 from a gate that also needs Redis.)
    for (const r of down) expect(r.status, JSON.stringify(statuses(down))).not.toBeLessThan(400);
    expect(await rows(t), 'nothing was created while Redis was down').toBe(before);

    // Recovery: wait until the app's Redis clients are back, then the same keys, each sent 3 times at once, make one row each.
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = (await create(t, 'probe-recovery', 'Probe')).status === 201;
      if (!up) await sleep(250);
    }
    expect(up, 'the app recovers without a restart').toBe(true);
    const keys = Array.from({ length: 6 }, (_, i) => `out-${i}`);
    const again = await race(18, (i) => create(t, keys[i % 6]!, `During outage ${i % 6}`), 30);
    for (const r of again) expect([201, 409], JSON.stringify(statuses(again))).toContain(r.status);
    expect(await rows(t)).toBe(before + 1 /* the probe */ + 6);
  }, 120_000);
});
