import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installFakeSms, switchSmsOn } from '../channel-sms/support';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { race, statuses } from './support';

/**
 * QA Sheet3 #15, CC-LIM-06: the capped creates that needed more set-up than the table in limits-all (a connected sender, a file upload,
 * a catalogue, a recurring schedule). Same rule: the room is measured one by one, then the same creates are sent at once.
 */
let h: Harness;
let api: Api;
beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  installFakeSms(h);
  await switchSmsOn(h);
}, 240_000);
afterAll(async () => {
  await h?.stop();
});

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${seq++}`;
const post = (t: Tenant, path: string, body: object) =>
  api.as(t.admin).post(path).set('Idempotency-Key', randomUUID()).send(body);
const withCap = async (label: string, limits: Record<string, number>) => {
  const t = await api.signup(label);
  await h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_build_object('features', jsonb_build_object('sms', true), 'limits', $2::jsonb) WHERE org_id = $1`,
    [t.orgId, JSON.stringify(limits)],
  );
  return t;
};
const ymd = new Date().toISOString().slice(0, 10);

type Make = (t: Tenant) => Promise<{ status: number; body: Record<string, unknown> }>;
const RESOURCES: Array<{ id: string; key: string; make: Make }> = [
  {
    id: 'CC-LIM-06a',
    key: 'catalog_products',
    make: (t) =>
      post(t, '/v2/catalog/products', {
        name: `P ${uniq()}`,
        priceMajor: '10.00',
        currencyCode: 'INR',
      }),
  },
  {
    id: 'CC-LIM-06b',
    key: 'recurring_invoices',
    make: (t) =>
      post(t, '/v2/recurring-invoices', {
        name: `Retainer ${uniq()}`,
        frequency: 'month',
        interval: 1,
        startDate: ymd,
        mode: 'issue',
        template: {
          buyerName: 'Retainer Co',
          buyerEmail: 'r@retainer.test',
          currency: 'USD',
          lines: [{ description: 'Retainer', qty: '1', unitPrice: '500.00', taxRateId: null }],
        },
      }),
  },
  {
    id: 'CC-LIM-06c',
    key: 'devices',
    make: (t) =>
      post(t, '/v2/sms/senders', {
        fromNumber: `+1737250${String(1000 + seq++)}`,
        accountSid: 'ACabc',
        authToken: 'tok-1',
      }),
  },
];

describe.each(RESOURCES)('$id $key: parallel creates at the cap', (r) => {
  it('leaves exactly as many rows as one-by-one creates allow, the rest refused with PLAN_LIMIT_REACHED', async () => {
    const cap = 3;
    const probe = await withCap(`m${r.id.slice(-1)}p`, { [r.key]: cap });
    let room = 0;
    for (let i = 0; i < cap + 3; i++) {
      const res = await r.make(probe);
      if (res.status === 201) room++;
      else {
        expect([422, 409], `${r.key}: ${JSON.stringify(res.body)}`).toContain(res.status);
        expect(res.body.code, JSON.stringify(res.body)).toBe('PLAN_LIMIT_REACHED');
        break;
      }
    }
    expect(room, `${r.key}: room`).toBeGreaterThan(0);
    expect(room).toBeLessThanOrEqual(cap);

    const t = await withCap(`m${r.id.slice(-1)}q`, { [r.key]: cap });
    const res = await race(room + 5, () => r.make(t));
    const ok = res.filter((x) => x.status === 201);
    for (const x of res.filter((y) => y.status !== 201)) {
      expect(x.body.code, JSON.stringify(x.body)).toBe('PLAN_LIMIT_REACHED');
    }
    expect(ok.length, `${r.key}: ${JSON.stringify(statuses(res))}`).toBe(room);
  });
});

describe('CC-LIM-06d saved replies imported in parallel', () => {
  it('6 uploads of one new reply each, on a cap of 3 replies: never more than 3 replies', async () => {
    const t = await withCap('m-imp', { saved_replies: 3 });
    const member = await api.member(t, 'impmgr', [['inbox.savedreply.manage', 'all']]);
    const res = await race(6, (i) =>
      api
        .as(member.token)
        .post('/v2/inbox/saved-replies/import')
        .attach('file', Buffer.from(`title,shortcut,body\nT${i},imp${i},Hello ${i}`), 'r.csv')
        .field('options', JSON.stringify({ duplicatePolicy: 'skip' })),
    );
    for (const r of res) expect(r.status, JSON.stringify(r.body)).toBeLessThan(500);
    const n = Number(
      (
        await h.owner.query(`SELECT count(*)::int AS n FROM saved_replies WHERE org_id = $1`, [
          t.orgId,
        ])
      ).rows[0].n,
    );
    expect(n, JSON.stringify(statuses(res))).toBeLessThanOrEqual(3);
    expect(n).toBeGreaterThan(0);
  });
});
