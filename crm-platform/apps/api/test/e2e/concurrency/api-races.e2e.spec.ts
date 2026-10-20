import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { PERSONAL_WA_NOTICE_VERSION } from '@crm/contracts';
import { ROUNDS, race, statuses } from './support';

/**
 * QA Sheet3 #15, HTTP side. Parallel requests through the real Nest app, real Postgres and Redis.
 * Scenarios: CC-LOCK-01/02 (optimistic locking), CC-IDEM-01/02 (Idempotency-Key), CC-DUP-01 (unique name),
 * CC-LIM-01/02 (plan limits: contacts, seats), CC-TEN-01 (two organizations at once).
 * The assertions are about the end state and the status codes, never about who wins.
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

const count = async (t: Tenant, table: string) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [t.orgId]))
      .rows[0].n,
  );

describe('CC-LOCK: two writers on one row (row_version)', () => {
  it.each([
    ['CC-LOCK-01 contact', '/v2/contacts', { name: 'Lock', email: 'lock@example.com' }, 'name'],
    ['CC-LOCK-02 company', '/v2/companies', { name: 'Lock Co' }, 'name'],
  ])(
    '%s: exactly one of 8 parallel updates wins, 7 get 409 ROW_VERSION_CONFLICT',
    async (_n, path, seed, field) => {
      const t = await api.signup('lock');
      const created = await api.as(t.admin).post(path).send(seed);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      let version = created.body.rowVersion as number;
      for (let round = 0; round < ROUNDS; round++) {
        const res = await race(8, (i) =>
          api
            .as(t.admin)
            .patch(`${path}/${created.body.id}`)
            .send({ [field]: `w${round}-${i}`, rowVersion: version }),
        );
        const won = res.filter((r) => r.status === 200);
        const lost = res.filter((r) => r.status === 409);
        expect(won.length, JSON.stringify(statuses(res))).toBe(1);
        expect(lost.length).toBe(7);
        for (const l of lost) expect(l.body.code).toBe('ROW_VERSION_CONFLICT');
        expect(won[0]!.body.rowVersion).toBe(version + 1);
        // The row holds the winner's value: no lost update.
        const get = await api.as(t.admin).get(`${path}/${created.body.id}`);
        expect(get.body[field]).toBe(won[0]!.body[field]);
        expect(get.body.rowVersion).toBe(version + 1);
        version += 1;
      }
    },
  );
});

describe('CC-IDEM: Idempotency-Key', () => {
  it('CC-IDEM-01 same key sent 10 times at once makes one row, never a 5xx', async () => {
    const t = await api.signup('idem');
    for (let round = 0; round < ROUNDS; round++) {
      const before = await count(t, 'companies');
      const key = `conc-${round}-${Math.random().toString(36).slice(2)}`;
      const res = await race(10, () =>
        api
          .as(t.admin)
          .post('/v2/companies')
          .set('Idempotency-Key', key)
          .send({ name: `Idem ${round}` }),
      );
      for (const r of res) expect([201, 409], JSON.stringify(r.body)).toContain(r.status);
      const ok = res.filter((r) => r.status === 201);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ok.map((r) => r.body.id)).size).toBe(1);
      expect(await count(t, 'companies')).toBe(before + 1);
    }
  });

  it('CC-IDEM-02 same key with different bodies at once: one runs, the rest are 409', async () => {
    const t = await api.signup('idem2');
    for (let round = 0; round < ROUNDS; round++) {
      const before = await count(t, 'companies');
      const key = `conc-diff-${round}-${Math.random().toString(36).slice(2)}`;
      const res = await race(6, (i) =>
        api
          .as(t.admin)
          .post('/v2/companies')
          .set('Idempotency-Key', key)
          .send({ name: `Diff ${round} ${i}` }),
      );
      for (const r of res) expect([201, 409], JSON.stringify(r.body)).toContain(r.status);
      expect(res.filter((r) => r.status === 201).length).toBe(1);
      expect(await count(t, 'companies')).toBe(before + 1);
    }
  });
});

describe('CC-DUP: unique constraints', () => {
  it('CC-DUP-01 eight parallel tags with one name: one 201, seven 409, one row', async () => {
    const t = await api.signup('dup');
    for (let round = 0; round < ROUNDS; round++) {
      const res = await race(8, () =>
        api
          .as(t.admin)
          .post('/v2/tags')
          .send({ name: `Same ${round}` }),
      );
      expect(res.filter((r) => r.status === 201).length, JSON.stringify(statuses(res))).toBe(1);
      expect(res.filter((r) => r.status === 409).length).toBe(7);
      const n = (
        await h.owner.query(`SELECT count(*)::int AS n FROM tags WHERE org_id = $1 AND name = $2`, [
          t.orgId,
          `Same ${round}`,
        ])
      ).rows[0].n;
      expect(n).toBe(1);
    }
  });
});

describe('CC-LIM: plan limits are check-then-insert', () => {
  it('CC-LIM-01 contacts: parallel creates of different people never pass the cap', async () => {
    const t = await api.signup('limc');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"contacts":5}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await race(12, (i) =>
      api
        .as(t.admin)
        .post('/v2/contacts')
        .send({ name: `P${i}`, email: `p${i}@example.com` }),
    );
    for (const r of res) expect([201, 422], JSON.stringify(r.body)).toContain(r.status);
    expect(res.filter((r) => r.status === 201).length).toBe(5);
    expect(await count(t, 'contacts')).toBe(5);
  });

  it('CC-LIM-02 seats: parallel invites never pass the user cap', async () => {
    const t = await api.signup('lims');
    // The owner already holds one seat.
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"users":3}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const role = (
      await h.owner.query(`SELECT uuid FROM roles WHERE org_id = $1 AND name = 'Agent'`, [t.orgId])
    ).rows[0].uuid as string;
    const res = await race(8, (i) =>
      api
        .as(t.admin)
        .post('/v2/workspace/members/invite')
        .send({ fullName: `Agent ${i}`, email: `agent${i}-lims@example.test`, roleId: role }),
    );
    for (const r of res) expect([201, 422], JSON.stringify(r.body)).toContain(r.status);
    const seats = (
      await h.owner.query(`SELECT count(*)::int AS n FROM users WHERE org_id = $1`, [t.orgId])
    ).rows[0].n;
    expect(seats, JSON.stringify(statuses(res))).toBeLessThanOrEqual(3);
    expect(res.filter((r) => r.status === 201).length).toBe(2);
  });
});

describe('CC-LIM tags and devices', () => {
  it('CC-LIM-03 tags: parallel creates of different names never pass the cap', async () => {
    const t = await api.signup('limt');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"tags":4}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const res = await race(10, (i) =>
      api
        .as(t.admin)
        .post('/v2/tags')
        .send({ name: `T${i}` }),
    );
    for (const r of res) expect([201, 422], JSON.stringify(r.body)).toContain(r.status);
    expect(await count(t, 'tags')).toBe(4);
    expect(res.filter((r) => r.status === 201).length).toBe(4);
  });

  it('CC-LIM-05 flows: parallel creates never pass the cap', async () => {
    const t = await api.signup('limf');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"flows":3}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const graph = {
      flowNodes: [
        { id: 'n_trig', type: 'trigger', x: 0, y: 0, data: { kind: 'keyword', keywords: 'hi' } },
        { id: 'n_msg', type: 'message', x: 300, y: 0, data: { text: 'hello' } },
      ],
      flowEdges: [{ id: 'e_1', source: 'n_trig', sourceHandle: 'out', target: 'n_msg' }],
      vars: [],
    };
    const res = await race(8, (i) =>
      api
        .as(t.admin)
        .post('/v2/flows')
        .send({ name: `F${i}`, graph }),
    );
    for (const r of res) expect([201, 422], JSON.stringify(r.body)).toContain(r.status);
    expect(await count(t, 'flows')).toBe(3);
  });

  it('CC-LIM-04 devices: parallel creates of different numbers never pass the cap, and one number is one device', async () => {
    const t = await api.signup('limd');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"devices":2}}'::jsonb WHERE org_id = $1`,
      [t.orgId],
    );
    const ack = { version: PERSONAL_WA_NOTICE_VERSION, items: [true, true, true], locale: 'en' };
    const mk = (phone: string) =>
      api
        .as(t.admin)
        .post('/v2/devices')
        .send({ name: 'Line', countryCode: '+91', phone, acknowledgement: ack });
    const res = await race(6, (i) => mk(`9811${String(100000 + i)}`));
    for (const r of res) expect([201, 422], JSON.stringify(r.body)).toContain(r.status);
    expect(await count(t, 'devices')).toBe(2);
    const t2 = await api.signup('limd2');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"devices":2}}'::jsonb WHERE org_id = $1`,
      [t2.orgId],
    );
    const same = await race(5, () =>
      api
        .as(t2.admin)
        .post('/v2/devices')
        .send({ name: 'Line', countryCode: '+91', phone: '9822222222', acknowledgement: ack }),
    );
    for (const r of same) expect([201, 409], JSON.stringify(r.body)).toContain(r.status);
    expect(same.filter((r) => r.status === 201).length).toBe(1);
    expect(await count(t2, 'devices')).toBe(1);
  });
});

describe('CC-TEN: tenant isolation under load', () => {
  it('CC-TEN-01 two organizations hammering the same endpoints never see each other', async () => {
    const a = await api.signup('tena');
    const b = await api.signup('tenb');
    const mk = (t: Tenant, tag: string) =>
      race(10, (i) =>
        api
          .as(t.admin)
          .post('/v2/contacts')
          .send({ name: `${tag}${i}`, email: `${tag}${i}@example.com` }),
      );
    const [ra, rb] = await Promise.all([mk(a, 'A'), mk(b, 'B')]);
    for (const r of [...ra, ...rb]) expect(r.status, JSON.stringify(r.body)).toBe(201);
    const [la, lb, xa, xb] = await Promise.all([
      api.as(a.admin).get('/v2/contacts?limit=100'),
      api.as(b.admin).get('/v2/contacts?limit=100'),
      // Each org asks for the other's contact while both are writing.
      api.as(a.admin).get(`/v2/contacts/${rb[0]!.body.id}`),
      api.as(b.admin).get(`/v2/contacts/${ra[0]!.body.id}`),
    ]);
    const names = (r: { body: { data: Array<{ name: string }> } }) =>
      r.body.data.map((c) => c.name);
    expect(names(la).every((n) => n.startsWith('A'))).toBe(true);
    expect(names(lb).every((n) => n.startsWith('B'))).toBe(true);
    expect(names(la)).toHaveLength(10);
    expect(names(lb)).toHaveLength(10);
    expect([xa.status, xb.status]).toEqual([404, 404]);
  });
});
