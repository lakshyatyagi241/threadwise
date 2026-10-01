import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacingRuntime } from '../../../src/modules/broadcasts/send-safety';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import {
  EngineSenderRegistry,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts/engine-senders';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * The per-recipient Cloud API payload and the send-time overrides (WD-BCAST-017, 015 rule 3): the real app and Postgres,
 * with fake engine adapters that record what they were asked to send.
 */
let h: Harness;
let api: Api;
let registry: EngineSenderRegistry;
let dispatch: BroadcastDispatchService;

let wabaSent: OutgoingMessage[] = [];
let baileysSent: OutgoingMessage[] = [];

beforeAll(async () => {
  h = await startHarness();
  // No real waiting between messages: the gaps are checked in broadcasts-pacing.e2e.spec.ts.
  h.app.get(PacingRuntime).sleep = () => Promise.resolve();
  api = new Api(h);
  registry = h.app.get(EngineSenderRegistry);
  dispatch = h.app.get(BroadcastDispatchService);
  const recorder = (into: () => OutgoingMessage[]) => ({
    open: () =>
      Promise.resolve({
        send: (m: OutgoingMessage) => {
          into().push(m);
          return Promise.resolve({ providerMessageId: `wamid.${into().length}` });
        },
      }),
  });
  registry.register(
    'waba',
    recorder(() => wabaSent),
  );
  registry.register(
    'baileys',
    recorder(() => baileysSent),
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

type Tpl = {
  body: string;
  header?: string;
  variableMap?: unknown;
  buttons?: unknown;
  attachmentType?: string;
  attachmentFile?: string;
};

let phoneCounter = 0;
async function arrange(
  label: string,
  tpl: Tpl,
  firstNames: Array<string | null>,
  engine: 'waba' | 'baileys' = 'waba',
) {
  const t = await api.signup(label);
  const templateId = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, header, variable_map, buttons, attachment_type,
                                 attachment_file, language, meta_template_id, meta_status, status)
       VALUES ($1, 'Promo Oct', $2, $3, $4::jsonb, $5::jsonb, $6, $7, 'en_US', $8, 'APPROVED', 'approved') RETURNING uuid`,
      [
        t.orgId,
        tpl.body,
        tpl.header ?? null,
        JSON.stringify(tpl.variableMap ?? {}),
        JSON.stringify(tpl.buttons ?? []),
        tpl.attachmentType ?? null,
        tpl.attachmentFile ?? null,
        `meta-${randomUUID()}`,
      ],
    )
  ).rows[0].uuid as string;

  const senderUuid =
    engine === 'waba'
      ? (
          await h.owner.query(
            `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, is_primary)
             VALUES ($1, 'waba', 'connected', '+919811100001', 'Acme Official', true) RETURNING uuid`,
            [t.orgId],
          )
        ).rows[0].uuid
      : (
          await h.owner.query(
            `INSERT INTO devices (org_id, device_name, country_code, phone_number, status, active)
             VALUES ($1, 'Main', '+91', '9811100001', 'connected', true) RETURNING uuid`,
            [t.orgId],
          )
        ).rows[0].uuid;

  const contacts = await api.seedContacts(
    t,
    firstNames.map((n, i) => ({
      name: `C${i}`,
      phone: `+91983${String(phoneCounter++).padStart(7, '0')}`,
    })),
  );
  for (const [i, uuid] of contacts.entries()) {
    await h.owner.query(`UPDATE contacts SET first_name = $1 WHERE uuid = $2`, [
      firstNames[i],
      uuid,
    ]);
  }
  return { t, templateId, senderKey: `${engine}:${senderUuid}`, contacts };
}

async function sendAll(
  a: { t: Tenant; templateId: string; senderKey: string; contacts: string[] },
  extra: Record<string, unknown> = {},
) {
  const res = await api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(a.t.admin))
    .set('idempotency-key', randomUUID())
    .send({
      name: 'Payload',
      templateId: a.templateId,
      contactIds: a.contacts,
      senderKeys: [a.senderKey],
      scheduleType: 'now',
      ...extra,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = Number(
    (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [res.body.broadcasts[0].id]))
      .rows[0].id,
  );
  await RequestContextStore.run(
    { requestId: `p-${id}`, orgId: a.t.orgId, actorType: 'system', actorId: null, userId: null },
    () => dispatch.run(a.t.orgId, id),
  );
  return id;
}

const reset = () => {
  wabaSent = [];
  baileysSent = [];
};

type Component = { type: string; parameters?: Array<Record<string, unknown>> };
const comps = (m: OutgoingMessage) => (m.components ?? []) as Component[];
const bodyTexts = (m: OutgoingMessage) =>
  comps(m)
    .find((c) => c.type === 'body')
    ?.parameters?.map((p) => p.text);

describe('WD-BCAST-017: the payload built for each recipient', () => {
  it('"Hi {{1}}" mapped to first_name gives each contact its own first name', async () => {
    reset();
    const a = await arrange(
      'p1',
      { body: 'Hi {{1}}', variableMap: { body: [{ num: 1, key: 'first_name' }] } },
      ['Ana', 'Ravi'],
    );
    await sendAll(a);
    expect(wabaSent.map(bodyTexts)).toEqual([['Ana'], ['Ravi']]);
    expect(wabaSent[0]).toMatchObject({ templateName: 'promo_oct', language: 'en_US' });
  });

  it('an image header is built even though the Meta v2 switch is off', async () => {
    reset();
    const a = await arrange(
      'p2',
      { body: 'Hello', attachmentType: 'IMAGE', attachmentFile: 'https://cdn.example.com/a.jpg' },
      ['Ana'],
    );
    await sendAll(a);
    expect(comps(wabaSent[0]!)[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/a.jpg' } }],
    });
  });

  it('a blank value is back-filled so the send is not rejected for an empty parameter', async () => {
    reset();
    const a = await arrange(
      'p3',
      { body: 'Hi {{1}}', variableMap: { body: [{ num: 1, key: 'first_name' }] } },
      [null],
    );
    await sendAll(a);
    expect(bodyTexts(wabaSent[0]!)).toEqual(['first_name']);
  });

  it('a contact attribute that is an array becomes a comma-joined string and the send does not crash', async () => {
    reset();
    const a = await arrange(
      'p4',
      { body: 'Interests: {{1}}', variableMap: { body: [{ num: 1, key: 'interests' }] } },
      ['Ana'],
    );
    await h.owner.query(
      `UPDATE contacts SET data = '{"interests":["tea","chess"]}'::jsonb WHERE uuid = $1`,
      [a.contacts[0]],
    );
    await sendAll(a);
    expect(bodyTexts(wabaSent[0]!)).toEqual(['tea, chess']);
  });

  it('a quick reply with no value gets no parameter; a URL with a placeholder gets its resolved link', async () => {
    reset();
    const a = await arrange(
      'p5',
      {
        body: 'Hello',
        variableMap: { body: [{ num: 1, key: 'first_name' }] },
        buttons: [
          { type: 'quick_reply', value: '' },
          { type: 'url', value: 'https://shop.example.com/{{1}}' },
          { type: 'phone_number', value: '+911234567890' },
        ],
      },
      ['Ana'],
    );
    const id = await sendAll(a);
    const buttons = comps(wabaSent[0]!).filter((c) => c.type === 'button');
    // Only the URL button takes a parameter, and it carries the recipient's own tracked link to the resolved address.
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({ type: 'button', sub_type: 'url', index: 1 });
    expect(String(buttons[0]!.parameters![0]!.text)).toMatch(/\/r\/[A-Za-z0-9]{12}$/);
    const rows = await h.owner.query(
      `SELECT original_url FROM wa_link_clicks WHERE broadcast_id = $1`,
      [id],
    );
    expect(rows.rows.map((r) => r.original_url)).toEqual(['https://shop.example.com/Ana']);
  });
});

describe('WD-BCAST-015 rule 3 and WD-BCAST-017 rule 9: send-time overrides', () => {
  it('are stored as null when everything is blank, and cleaned when something is filled', async () => {
    reset();
    const a = await arrange(
      'o1',
      { body: 'Hi {{1}}', variableMap: { body: [{ num: 1, key: 'first_name' }] } },
      ['Ana'],
    );
    const create = async (templateOverrides: unknown) => {
      const res = await api
        .http()
        .post('/v2/broadcasts')
        .set(bearer(a.t.admin))
        .set('idempotency-key', randomUUID())
        .send({
          name: 'O',
          templateId: a.templateId,
          contactIds: a.contacts,
          scheduleType: 'now',
          templateOverrides,
        });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return (
        await h.owner.query(`SELECT template_overrides FROM broadcasts WHERE uuid = $1`, [
          res.body.broadcasts[0].id,
        ])
      ).rows[0].template_overrides;
    };
    expect(await create({ body: ['', '  '], header: { mode: 'text', text: '' } })).toBeNull();
    expect(await create({ body: [' VIP '], junk: 1 })).toEqual({ body: ['VIP'] });
  });

  it('a filled body slot wins for every recipient on a waba slice; the rest keep the template value', async () => {
    reset();
    const a = await arrange(
      'o2',
      {
        body: 'Hi {{1}} from {{2}}',
        variableMap: {
          body: [
            { num: 1, key: 'first_name' },
            { num: 2, key: 'company_name' },
          ],
        },
      },
      ['Ana', 'Ravi'],
    );
    await sendAll(a, { templateOverrides: { body: ['VIP'] } });
    expect(wabaSent.map(bodyTexts).map((t) => t?.[0])).toEqual(['VIP', 'VIP']);
    // The second slot was not overridden, so it still comes from the template (the organization name).
    expect(bodyTexts(wabaSent[0]!)![1]).toMatch(/^Org /);
  });

  it('{{tokens}} typed in an override are resolved per recipient', async () => {
    reset();
    const a = await arrange(
      'o3',
      { body: 'Hi {{1}}', variableMap: { body: [{ num: 1, key: 'first_name' }] } },
      ['Ana', 'Ravi'],
    );
    await sendAll(a, { templateOverrides: { body: ['Dear {{first_name}}'] } });
    expect(wabaSent.map(bodyTexts)).toEqual([['Dear Ana'], ['Dear Ravi']]);
  });

  it('a button override replaces the value by index', async () => {
    reset();
    const a = await arrange(
      'o4',
      { body: 'Hello', buttons: [{ type: 'url', value: 'https://shop.example.com/{{1}}' }] },
      ['Ana'],
    );
    await sendAll(a, {
      templateOverrides: {
        buttons: [{ index: 0, subType: 'url', value: 'https://promo.example.com/{{first_name}}' }],
      },
    });
    const btn = comps(wabaSent[0]!).find((c) => c.type === 'button');
    expect(String(btn?.parameters?.[0]?.text)).toMatch(/\/r\/[A-Za-z0-9]{12}$/);
    const links = await h.owner.query(`SELECT original_url FROM wa_link_clicks WHERE org_id = $1`, [
      a.t.orgId,
    ]);
    expect(links.rows.map((r) => r.original_url)).toEqual(['https://promo.example.com/Ana']);
  });

  it('on a baileys slice the overrides are not applied and no Cloud API components are sent (WaDesk quirk, kept)', async () => {
    reset();
    const a = await arrange(
      'o5',
      { body: 'Hi {{1}}', variableMap: { body: [{ num: 1, key: 'first_name' }] } },
      ['Ana'],
      'baileys',
    );
    await sendAll(a, { templateOverrides: { body: ['VIP'] } });
    expect(baileysSent).toHaveLength(1);
    expect(baileysSent[0]!.components).toBeUndefined();
  });
});
