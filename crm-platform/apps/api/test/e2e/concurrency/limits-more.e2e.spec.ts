import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
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

// --- set-up shared by the resources below, made once per workspace ---------------------------------------------------------------------
const once = new Map<string, Promise<unknown>>();
const setup = <T>(t: Tenant, what: string, make: () => Promise<T>) => {
  const k = `${t.orgId}:${what}`;
  if (!once.has(k)) once.set(k, make());
  return once.get(k) as Promise<T>;
};
const device = (t: Tenant) =>
  setup(t, 'device', async () => {
    const r = (
      await h.owner.query(
        `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
         VALUES ($1, 'Phone', '+91', $2, 'connected', true) RETURNING uuid`,
        [t.orgId, `98111${String(10000 + seq++)}`],
      )
    ).rows[0];
    return r.uuid as string;
  });
const approvedTemplate = (t: Tenant) =>
  setup(
    t,
    'template',
    async () =>
      (
        await h.owner.query(
          `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status)
         VALUES ($1, $2, 'Hello', 'standard', 'approved') RETURNING uuid`,
          [t.orgId, `t${randomUUID().slice(0, 8)}`],
        )
      ).rows[0].uuid as string,
  );
const contacts = (t: Tenant) =>
  setup(t, 'contacts', () =>
    api.seedContacts(
      t,
      Array.from({ length: 3 }, (_, i) => ({
        name: `C${i}`,
        phone: `+91981${String(1000000 + seq++)}`,
      })),
    ),
  );
const wabaConnection = (t: Tenant) =>
  setup(t, 'conn', async () => {
    const crypto = h.app.get(CryptoService, { strict: false });
    const n = seq++;
    return (
      await h.owner.query(
        `INSERT INTO wa_provider_configs (org_id, provider, status, credentials_json, meta_json, phone_number, display_label, is_primary, connected_at)
         VALUES ($1, 'waba', 'connected', $2, $3::jsonb, '+919112290122', 'Acme', true, now()) RETURNING uuid`,
        [
          t.orgId,
          crypto.encrypt(JSON.stringify({ access_token: 'TOKEN-1' })),
          JSON.stringify({
            waba_id: `1000${Date.now() % 100000}${n}`,
            phone_number_id: `2000${n}`,
            provider: 'meta',
          }),
        ],
      )
    ).rows[0].uuid as string;
  });

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
  {
    id: 'CC-LIM-06e',
    key: 'templates',
    make: async (t) =>
      post(t, '/v2/templates', {
        name: `Tpl ${uniq()}`.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        language: 'en_US',
        metaCategory: 'UTILITY',
        templateType: 'standard',
        body: 'Hi {{name}}',
        variableMap: { body: [{ num: 1, key: 'name', example: 'Ana' }] },
        connectionId: await wabaConnection(t),
        submit: false,
      }),
  },
  {
    id: 'CC-LIM-06f',
    key: 'scheduled_messages',
    make: async (t) =>
      post(t, '/v2/scheduled', {
        name: `Sched ${uniq()}`,
        scheduleType: 'once',
        sendDate: '2031-03-10',
        sendTime: '10:30',
        timezone: 'UTC',
        senders: [`baileys:${await device(t)}`],
        messageType: 'plain',
        message: 'Hello {{name}}',
        recipientType: 'number',
        numbers: [`+9198222${String(10000 + seq++)}`],
      }),
  },
  {
    id: 'CC-LIM-06g',
    key: 'broadcasts',
    make: async (t) =>
      post(t, '/v2/broadcasts', {
        name: `Bcast ${uniq()}`,
        templateId: await approvedTemplate(t),
        contactIds: await contacts(t),
        senderKeys: [`baileys:${await device(t)}`],
        scheduleType: 'now',
      }),
  },
  {
    id: 'CC-LIM-06h',
    key: 'total_campaigns',
    make: async (t) =>
      post(t, '/v2/campaigns', {
        name: `Camp ${uniq()}`,
        type: 'text',
        customMessage: 'Hi {{name}}',
        scheduleType: 'now',
        senderKey: `baileys:${await device(t)}`,
        contactIds: await contacts(t),
      }),
  },
  {
    id: 'CC-LIM-06i',
    key: 'custom_fields',
    make: async (t) => {
      const section = await setup(t, 'section', async () => {
        const r = await api
          .as(t.admin)
          .post('/v2/field-sections')
          .send({ moduleKey: 'contacts', name: 'Extra' });
        return r.body.id as string;
      });
      return post(t, '/v2/fields', {
        moduleKey: 'contacts',
        sectionId: section,
        key: `fld_${uniq()}`,
        label: `Field ${uniq()}`,
        fieldType: 'integer',
      });
    },
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
