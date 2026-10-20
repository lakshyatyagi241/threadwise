import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';
import { sleep } from './support';

/**
 * QA Sheet3 #15, CC-OBX-03: two real outbox drain nodes. Each node is its own OS process (tsx) with its own connection pool, running
 * the real `OutboxDrainService` against the same Postgres. Nothing is shared between them but the database.
 */
let h: Harness;
const API = resolve(__dirname, '../../..');
const TSX = resolve(API, 'node_modules/.bin/tsx');
const SCRIPT = resolve(__dirname, 'node/drain-node.ts');
const children: ChildProcess[] = [];

beforeAll(async () => {
  h = await startHarness();
  await h.owner.query(
    `CREATE TABLE conc_node_deliveries (id bigserial PRIMARY KEY, event_id text NOT NULL, node text NOT NULL, at timestamptz NOT NULL DEFAULT now())`,
  );
  await h.owner.query(
    `GRANT ALL ON conc_node_deliveries, conc_node_deliveries_id_seq TO crm_app_user`,
  );
}, 240_000);
afterAll(async () => {
  for (const c of children) c.kill('SIGKILL');
  await h?.stop();
});

let seq = 0;
const q = (text: string, params: unknown[] = []) => h.owner.query(text, params);

async function seed(n: number): Promise<{ eventType: string; orgId: number }> {
  const eventType = `conc.node.${Date.now()}.${seq++}`;
  const orgId = Number(
    (await q(`SELECT id FROM organizations ORDER BY id LIMIT 1`)).rows[0]?.id ??
      (
        await q(
          `INSERT INTO organizations (slug, name, plan) VALUES ($1, 'Node Org', 'starter') RETURNING id`,
          [`node-org-${eventType.slice(-6)}`],
        )
      ).rows[0].id,
  );
  await q(
    `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
     SELECT $1, 'conc', (g % 60), $2, jsonb_build_object('n', g) FROM generate_series(1, $3) g`,
    [orgId, eventType, n],
  );
  return { eventType, orgId };
}

function startNode(
  name: string,
  eventType: string,
  handleMs: number,
): { proc: ChildProcess; done: Promise<number | null>; out: string[] } {
  const out: string[] = [];
  const proc = spawn(TSX, [SCRIPT], {
    cwd: API,
    env: {
      ...process.env,
      NODE_NAME: name,
      EVENT_TYPE: eventType,
      HANDLE_MS: String(handleMs),
      DATABASE_URL: process.env.DATABASE_URL!,
      RECORDER_URL: process.env.MIGRATION_DATABASE_URL!,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(proc);
  proc.stdout!.on('data', (d) => out.push(String(d)));
  proc.stderr!.on('data', (d) => out.push(String(d)));
  const done = new Promise<number | null>((r) =>
    proc.on('exit', (code) => r(code)).on('error', () => r(-1)),
  );
  return { proc, done, out };
}

const deliveries = async (eventType: string) =>
  (
    await q(
      `SELECT d.event_id, d.node FROM conc_node_deliveries d JOIN event_outbox o ON o.id::text = d.event_id WHERE o.event_type = $1`,
      [eventType],
    )
  ).rows as Array<{ event_id: string; node: string }>;

describe('CC-OBX-03 two drain processes on one backlog', () => {
  it('1200 events, two separate processes: every event is delivered exactly once, both processes did work, no row is left', async () => {
    const { eventType } = await seed(1200);
    const a = startNode('node-a', eventType, 2);
    const b = startNode('node-b', eventType, 2);
    const codes = await Promise.all([a.done, b.done]);
    expect(codes, `${a.out.join('')}${b.out.join('')}`).toEqual([0, 0]);
    const rows = await deliveries(eventType);
    const perEvent = new Map<string, number>();
    for (const r of rows) perEvent.set(r.event_id, (perEvent.get(r.event_id) ?? 0) + 1);
    expect(perEvent.size).toBe(1200);
    expect([...perEvent.values()].every((n) => n === 1)).toBe(true);
    const perNode = new Map<string, number>();
    for (const r of rows) perNode.set(r.node, (perNode.get(r.node) ?? 0) + 1);
    expect(perNode.get('node-a') ?? 0).toBeGreaterThan(0);
    expect(perNode.get('node-b') ?? 0).toBeGreaterThan(0);
    const left = Number(
      (
        await q(
          `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status <> 'done'`,
          [eventType],
        )
      ).rows[0].n,
    );
    expect(left).toBe(0);
  }, 180_000);

  it('one process is killed (SIGKILL) in the middle of a batch: the other finishes the backlog, no event is lost, at most the killed batch is delivered twice', async () => {
    const { eventType } = await seed(1200);
    const a = startNode('node-a', eventType, 5);
    const b = startNode('node-b', eventType, 5);
    // Wait until A has really started handling events, then kill it hard.
    for (let i = 0; i < 400; i++) {
      const n = (await deliveries(eventType)).filter((r) => r.node === 'node-a').length;
      if (n >= 20) break;
      await sleep(50);
    }
    a.proc.kill('SIGKILL');
    const [, codeB] = await Promise.all([a.done, b.done]);
    expect(codeB, b.out.join('')).toBe(0);
    const rows = await deliveries(eventType);
    const perEvent = new Map<string, number>();
    for (const r of rows) perEvent.set(r.event_id, (perEvent.get(r.event_id) ?? 0) + 1);
    expect(perEvent.size, 'every event delivered at least once: none lost').toBe(1200);
    const twice = [...perEvent.values()].filter((n) => n > 1).length;
    // The killed node's claim rolled back, so what it had handled so far is handled again by the survivor: at most one batch (200).
    expect(twice).toBeLessThanOrEqual(200);
    expect([...perEvent.values()].every((n) => n <= 2)).toBe(true);
    const left = Number(
      (
        await q(
          `SELECT count(*)::int AS n FROM event_outbox WHERE event_type = $1 AND status <> 'done'`,
          [eventType],
        )
      ).rows[0].n,
    );
    expect(left).toBe(0);
  }, 180_000);
});
