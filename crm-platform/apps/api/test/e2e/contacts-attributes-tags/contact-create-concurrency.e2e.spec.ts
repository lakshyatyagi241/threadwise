import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness } from './support';

/**
 * Creating the same person at the same moment (a sheet row sent twice, a form and a flow together) must give one contact: the identity
 * lookup and the insert are separate statements, so only the advisory lock in `ContactsService.create` keeps two requests from both
 * finding nobody. Real Postgres, real requests, in parallel.
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

const count = async (orgId: number) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [orgId]))
      .rows[0].n,
  );

describe('contact create under concurrency', () => {
  it('ten parallel creates of one email make one contact, and every caller gets that contact', async () => {
    const t = await api.signup('conc-email');
    const res = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.as(t.admin).post('/v2/contacts').send({ name: 'Ana', email: 'Ana@Example.com' }),
      ),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(await count(t.orgId)).toBe(1);
  });

  it('parallel creates of one phone, and of that phone plus an email, make one contact', async () => {
    const t = await api.signup('conc-phone');
    const body = [
      { name: 'Bo', phone: '+919811100001' },
      { name: 'Bo', phone: '+919811100001', email: 'bo@example.com' },
    ];
    const res = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        api
          .as(t.admin)
          .post('/v2/contacts')
          .send(body[i % 2]),
      ),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(await count(t.orgId)).toBe(1);
  });

  it('different people created at once all exist, and another workspace is unaffected', async () => {
    const a = await api.signup('conc-a');
    const b = await api.signup('conc-b');
    const res = await Promise.all([
      ...Array.from({ length: 6 }, (_, i) =>
        api
          .as(a.admin)
          .post('/v2/contacts')
          .send({ name: `P${i}`, email: `p${i}@example.com` }),
      ),
      api.as(b.admin).post('/v2/contacts').send({ name: 'P0', email: 'p0@example.com' }),
    ]);
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect(await count(a.orgId)).toBe(6);
    expect(await count(b.orgId)).toBe(1);
  });
});
