import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { widgetBody } from '../chatbot-widget/support';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';
import { race, statuses } from './support';

/**
 * QA Sheet3 #15, D-05. Every capped resource whose create is a count-then-insert: N creates at once on a plan with room for only a few
 * must leave exactly as many rows as the plan allows, the rest refused with 422 PLAN_LIMIT_REACHED, never an over-limit row.
 *
 * The room is measured, not assumed: on one workspace the resource is created one by one until the plan refuses; on a fresh
 * workspace with the same cap the same creates are then sent at once. Scenarios CC-LIM-08 to CC-LIM-18.
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

type Make = (t: Tenant, n: number) => Promise<{ status: number; body: Record<string, unknown> }>;
interface Resource {
  id: string;
  key: string;
  cap: number;
  make: Make;
}
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${seq++}`;
const post = (t: Tenant, path: string, body: object) =>
  api.as(t.admin).post(path).set('Idempotency-Key', randomUUID()).send(body);

const RESOURCES: Resource[] = [
  {
    id: 'CC-LIM-08',
    key: 'segments',
    cap: 4,
    make: (t) =>
      post(t, '/v2/segments', {
        name: `Seg ${uniq()}`,
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'contains', value: 'z' }],
        },
      }),
  },
  {
    id: 'CC-LIM-09',
    key: 'custom_fields',
    cap: 4,
    make: (t) => post(t, '/v2/attributes', { name: `Attr ${uniq()}`, key: `attr_${uniq()}` }),
  },
  {
    id: 'CC-LIM-10',
    key: 'saved_replies',
    cap: 4,
    make: (t) =>
      post(t, '/v2/inbox/saved-replies', { shortcut: `s${uniq()}`, title: 'T', body: 'Hello' }),
  },
  {
    id: 'CC-LIM-11',
    key: 'routing_rules',
    cap: 4,
    make: async (t) => {
      const uuid = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [t.adminUserId]))
        .rows[0].uuid as string;
      return post(t, '/v2/inbox/routing/rules', {
        name: `Rule ${uniq()}`,
        conditions: { keywords: { mode: 'any', words: ['refund'] } },
        assign: { strategy: 'specific', userIds: [uuid] },
      });
    },
  },
  {
    id: 'CC-LIM-12',
    key: 'team_chat_channels',
    cap: 4,
    make: (t) => post(t, '/v2/team-chat/channels', { name: `chan-${uniq()}`, type: 'public' }),
  },
  {
    id: 'CC-LIM-13',
    key: 'pipelines',
    cap: 4,
    make: (t) => post(t, '/v2/pipelines', { name: `Pipe ${uniq()}` }),
  },
  {
    id: 'CC-LIM-14',
    key: 'forms',
    cap: 4,
    make: (t) => post(t, '/v2/forms', { name: `Form ${uniq()}` }),
  },
  {
    id: 'CC-LIM-15',
    key: 'lead_sources',
    cap: 4,
    make: (t) => post(t, '/v2/lead-sources', { name: `Src ${uniq()}` }),
  },
  {
    id: 'CC-LIM-16',
    key: 'booking_types',
    cap: 4,
    make: (t) =>
      post(t, '/v2/booking-types', {
        name: `Service ${uniq()}`,
        durationMinutes: 30,
        minNoticeMinutes: 0,
        maxAdvanceDays: 30,
        timezone: 'UTC',
        availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          from: '00:00',
          to: '23:59',
        })),
      }),
  },
  {
    id: 'CC-LIM-17',
    key: 'invoices_monthly',
    cap: 4,
    make: (t) =>
      post(t, '/v2/invoices', {
        buyerName: 'Conc Co',
        currency: 'USD',
        lines: [{ description: 'Widget', qty: '1', unitPrice: '10.00', taxRateId: null }],
      }),
  },
  {
    id: 'CC-LIM-18',
    key: 'chatbot_widgets',
    cap: 4,
    make: (t) => post(t, '/v2/widgets', widgetBody({ name: `Widget ${uniq()}` })),
  },
];

const withCap = async (label: string, key: string, cap: number) => {
  const t = await api.signup(label);
  await h.owner.query(
    `UPDATE org_plan_state SET overrides = jsonb_build_object('limits', jsonb_build_object($2::text, $3::int)) WHERE org_id = $1`,
    [t.orgId, key, cap],
  );
  return t;
};

describe.each(RESOURCES)('$id $key: parallel creates at the cap', (r) => {
  it('leaves exactly as many rows as one-by-one creates allow, the rest refused with PLAN_LIMIT_REACHED', async () => {
    // 1. How much room does this plan leave, serially.
    const probe = await withCap(`lp${r.key}`.slice(0, 12), r.key, r.cap);
    let room = 0;
    for (let i = 0; i < r.cap + 3; i++) {
      const res = await r.make(probe, i);
      if (res.status === 201) room++;
      else {
        expect(res.status, `${r.key}: ${JSON.stringify(res.body)}`).toBe(422);
        expect(res.body.code, JSON.stringify(res.body)).toBe('PLAN_LIMIT_REACHED');
        break;
      }
    }
    expect(room, `${r.key}: the plan must leave room for at least one create`).toBeGreaterThan(0);
    expect(room).toBeLessThanOrEqual(r.cap);

    // 2. The same workspace shape, creates sent at once.
    const t = await withCap(`lq${r.key}`.slice(0, 12), r.key, r.cap);
    const res = await race(room + 5, (i) => r.make(t, i));
    const ok = res.filter((x) => x.status === 201);
    const refused = res.filter((x) => x.status !== 201);
    for (const x of refused) {
      expect(x.status, JSON.stringify(x.body)).toBe(422);
      expect(x.body.code).toBe('PLAN_LIMIT_REACHED');
    }
    expect(ok.length, `${r.key}: ${JSON.stringify(statuses(res))}`).toBe(room);
  });
});
