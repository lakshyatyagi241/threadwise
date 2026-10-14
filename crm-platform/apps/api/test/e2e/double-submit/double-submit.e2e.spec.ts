import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Double submit (QA task 16). A person double-clicks, or a client retries after a timeout: the same create must not happen twice.
 * The mechanism is `@Idempotent()` plus an `Idempotency-Key` header (`IdempotencyInterceptor`: Redis SET NX per organisation, a
 * stored reply for 24 hours, 409 while the first request is still running, the key freed when the first one fails).
 *
 * Each row below is a real create route that carries `@Idempotent()`. The same six behaviours are proved on every row, through
 * real HTTP, Redis and Postgres.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

interface Row {
  name: string;
  path: string;
  table: string;
  /** A valid body that differs for every `n` (unique names, phones), so two different keys make two rows. */
  body: (n: number) => Record<string, unknown>;
  /** What the same body sent twice WITHOUT a key does today. `duplicates` is the exposure the key exists to close. */
  withoutKey: 'one row, repeat answered 201' | 'one row, repeat refused 409' | 'two rows';
}

const phone = (n: number) => `+9198${String(70000000 + n).padStart(8, '0')}`;
let seq = 0;
const next = () => ++seq;

const ROWS: Row[] = [
  {
    name: 'contact',
    path: '/v2/contacts',
    table: 'contacts',
    body: (n) => ({ phone: phone(n) }),
    withoutKey: 'one row, repeat answered 201',
  },
  {
    name: 'tag',
    path: '/v2/tags',
    table: 'tags',
    body: (n) => ({ name: `Tag ${n}` }),
    withoutKey: 'one row, repeat refused 409',
  },
  {
    name: 'company',
    path: '/v2/companies',
    table: 'companies',
    body: (n) => ({ name: `Company ${n}` }),
    withoutKey: 'two rows',
  },
  {
    name: 'task',
    path: '/v2/tasks',
    table: 'tasks',
    body: (n) => ({ title: `Task ${n}` }),
    withoutKey: 'two rows',
  },
];

const count = async (t: Tenant, table: string) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [t.orgId]))
      .rows[0].n,
  );

const post = (t: Tenant, path: string, body: unknown, key?: string) => {
  const r = api.as(t.admin).post(path);
  if (key) r.set('Idempotency-Key', key);
  return r.send(body as object);
};

describe.each(ROWS)('creating a $name twice', (row) => {
  let t: Tenant;
  beforeAll(async () => {
    t = await api.signup(`ds-${row.name}`);
  });

  it('two requests at once with one key make one row: the second is a 409 or the same reply', async () => {
    const before = await count(t, row.table);
    const body = row.body(next());
    const key = `k-${row.name}-concurrent`;
    const [a, b] = await Promise.all([post(t, row.path, body, key), post(t, row.path, body, key)]);
    const ok = [a, b].filter((r) => r.status === 201);
    const conflict = [a, b].filter((r) => r.status === 409);
    expect(ok.length, JSON.stringify([a.body, b.body])).toBeGreaterThanOrEqual(1);
    expect(ok.length + conflict.length).toBe(2);
    if (ok.length === 2) expect(ok[0]!.body).toEqual(ok[1]!.body);
    expect(await count(t, row.table)).toBe(before + 1);
  });

  it('a repeat after the first finished gets the same reply and makes no second row', async () => {
    const before = await count(t, row.table);
    const body = row.body(next());
    const key = `k-${row.name}-replay`;
    const first = await post(t, row.path, body, key);
    const second = await post(t, row.path, body, key);
    expect(first.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(await count(t, row.table)).toBe(before + 1);
  });

  it('two different keys are two different requests', async () => {
    const before = await count(t, row.table);
    const a = await post(t, row.path, row.body(next()), `k-${row.name}-a`);
    const b = await post(t, row.path, row.body(next()), `k-${row.name}-b`);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await count(t, row.table)).toBe(before + 2);
  });

  it('a request that fails frees its key, so the corrected retry goes through', async () => {
    const before = await count(t, row.table);
    const key = `k-${row.name}-freed`;
    const bad = await post(t, row.path, { not: 'valid' }, key);
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const good = await post(t, row.path, row.body(next()), key);
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    expect(await count(t, row.table)).toBe(before + 1);
  });

  it('the same key in another organisation is a separate request', async () => {
    const other = await api.signup(`ds-${row.name}-other`);
    const key = `k-${row.name}-shared`;
    const mine = await post(t, row.path, row.body(next()), key);
    const theirs = await post(other, row.path, row.body(next()), key);
    expect([mine.status, theirs.status]).toEqual([201, 201]);
    expect(theirs.body.id).not.toBe(mine.body.id);
  });

  it("without a key nothing is remembered: the same body twice is left to the route's own rules", async () => {
    const before = await count(t, row.table);
    const body = row.body(next());
    const a = await post(t, row.path, body);
    const b = await post(t, row.path, body);
    expect(a.status).toBe(201);
    const made = (await count(t, row.table)) - before;
    const outcome =
      made === 2
        ? 'two rows'
        : b.status === 409
          ? 'one row, repeat refused 409'
          : 'one row, repeat answered 201';
    expect(outcome).toBe(row.withoutKey);
  });
});

describe('one key, two different requests', () => {
  it("a different route under the same key runs on its own and never gets the first request's reply", async () => {
    const t = await api.signup('ds-mismatch-route');
    const key = 'k-mismatch-route';
    const first = await post(t, '/v2/tags', { name: 'Original' }, key);
    const second = await post(t, '/v2/companies', { name: 'Different thing' }, key);
    expect(first.status).toBe(201);
    // The key is scoped to who, which method and which path (ADR 0029), so this is a different operation, not a replay.
    expect(second.status).toBe(201);
    expect(second.body).not.toEqual(first.body);
    expect(second.body).toMatchObject({ name: 'Different thing' });
  });

  it('the same route and key with a different body is 409 IDEMPOTENCY_KEY_REUSED and creates nothing', async () => {
    const t = await api.signup('ds-mismatch-body');
    const key = 'k-mismatch-body';
    const first = await post(t, '/v2/companies', { name: 'Original co' }, key);
    const before = await count(t, 'companies');
    const second = await post(t, '/v2/companies', { name: 'Another co' }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count(t, 'companies')).toBe(before);
  });
});
