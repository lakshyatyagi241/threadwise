import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { startHarness, type Harness } from '../auth-registration-security/harness';

/**
 * Concurrency and noisy-neighbour checks from the multi-tenancy isolation audit (MT-007, MT-048, MT-093, MT-094).
 * Real Postgres and the real AppModule in one Node process, so the tenant context really is shared machinery
 * (AsyncLocalStorage, pooled connections, transaction-local GUCs) under interleaving.
 *
 * What this does NOT prove: behaviour under production load across several processes. It is a liveness and
 * context-isolation check, not a load test (see TI-015 / TI-016 in tools/tenancy-audit/policy/findings.json).
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

interface Account {
  token: string;
  slug: string;
}
let ip = 200;
async function signup(label: string): Promise<Account> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', `10.7.0.${ip++}`)
    .send({
      orgName: `Conc ${label}`,
      fullName: 'Conc Person',
      email: `${label}${Date.now()}@example.test`,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const token = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(token));
  expect(session.status).toBe(200);
  return { token, slug: session.body.org.slug as string };
}

let a: Account;
let b: Account;

beforeAll(async () => {
  h = await startHarness();
  a = await signup('conca');
  b = await signup('concb');
}, 900_000);

afterAll(async () => {
  await h?.stop();
});

describe('tenant context under interleaving (MT-007, MT-048)', () => {
  it('every concurrent request is answered for the workspace that sent it', async () => {
    const calls = Array.from({ length: 120 }, (_, i) => {
      const who = i % 2 === 0 ? a : b;
      return api()
        .get('/v2/auth/session')
        .set(bearer(who.token))
        .then((r) => ({ want: who.slug, status: r.status, got: r.body?.org?.slug as string }));
    });
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.status !== 200)).toEqual([]);
    expect(results.filter((r) => r.got !== r.want)).toEqual([]);
  });

  it("a pooled connection never keeps the previous request's tenant", async () => {
    // After the burst above, the application pool's connections have served both workspaces. A query run on that same pool with
    // no tenant context must see no tenant rows at all, whichever connection it is handed: the context is transaction-local.
    const db = h.app.get(DatabaseService);
    const seen = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const res = (await db.primary.execute(
          sql`SELECT (SELECT count(*) FROM organizations)::int AS orgs, current_setting('app.org_id', true) AS org`,
        )) as unknown as { rows: Array<{ orgs: number; org: string | null }> };
        return res.rows[0]!;
      }),
    );
    expect(seen.filter((r) => r.orgs !== 0)).toEqual([]);
    expect(seen.filter((r) => r.org !== null && r.org !== '')).toEqual([]);
  });
});

describe('tenant responses stay out of shared caches (MT-069)', () => {
  it('authenticated tenant data is never marked public or given a shared-cache lifetime', async () => {
    for (const path of ['/v2/contacts', '/v2/auth/session']) {
      const res = await api().get(path).set(bearer(a.token));
      expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(200);
      const cacheControl = String(res.headers['cache-control'] ?? '');
      expect(cacheControl, path).not.toMatch(/\bpublic\b|s-maxage/i);
    }
  });
});

describe('one workspace bursting does not take another one down (MT-093, MT-094)', () => {
  it('keeps answering the other workspace while this one sends a burst', async () => {
    const burst = Array.from({ length: 150 }, () =>
      api().get('/v2/auth/session').set(bearer(a.token)),
    );
    const started = Date.now();
    const bursting = Promise.allSettled(burst);
    const others: number[] = [];
    // The neighbour polls while the burst is in flight.
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const res = await api().get('/v2/auth/session').set(bearer(b.token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.org.slug).toBe(b.slug);
      others.push(Date.now() - t0);
    }
    await bursting;
    // Liveness, not a latency SLO: the neighbour was never refused and no single answer took longer than the DB statement timeout.
    expect(Math.max(...others)).toBeLessThan(15_000);
    expect(Date.now() - started).toBeLessThan(120_000);
  });
});
