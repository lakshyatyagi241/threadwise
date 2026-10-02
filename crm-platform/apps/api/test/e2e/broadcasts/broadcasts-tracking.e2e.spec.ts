import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PacingRuntime } from '../../../src/modules/broadcasts/send-safety';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { BroadcastDispatchService } from '../../../src/modules/broadcasts/broadcast-dispatch.service';
import {
  EngineSenderRegistry,
  type OutgoingMessage,
} from '../../../src/modules/broadcasts/engine-senders';
import { LinkTracker } from '../../../src/modules/broadcasts/tracking/link-tracker';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

/**
 * Link tracking (WD-BCAST-018, 042): links wrapped per recipient at dispatch, the public redirect and what a tap changes,
 * against a real Postgres and Redis.
 */
let h: Harness;
let api: Api;
let db: DatabaseService;
let tracker: LinkTracker;
let wabaSent: OutgoingMessage[] = [];

const BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';

beforeAll(async () => {
  h = await startHarness();
  // No real waiting between messages: the gaps are checked in broadcasts-pacing.e2e.spec.ts.
  h.app.get(PacingRuntime).sleep = () => Promise.resolve();
  api = new Api(h);
  db = h.app.get(DatabaseService);
  tracker = h.app.get(LinkTracker);
  h.app.get(EngineSenderRegistry).register('waba', {
    open: () =>
      Promise.resolve({
        send: (m: OutgoingMessage) => {
          wabaSent.push(m);
          return Promise.resolve({ providerMessageId: `wamid.${wabaSent.length}` });
        },
      }),
  });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

let counter = 0;
async function arrange(
  label: string,
  n: number,
  buttons: unknown = [{ type: 'url', value: 'https://shop.example.com/p/{{1}}' }],
) {
  const t = await api.signup(label);
  const templateId = (
    await h.owner.query(
      `INSERT INTO wa_templates (org_id, template_name, template_body, buttons, variable_map, language, meta_template_id, meta_status, status)
       VALUES ($1,'promo','Hello','${JSON.stringify(buttons).replace(/'/g, "''")}'::jsonb,'{"body":[{"num":1,"key":"first_name"}]}'::jsonb,'en_US',$2,'APPROVED','approved') RETURNING uuid`,
      [t.orgId, `meta-${randomUUID()}`],
    )
  ).rows[0].uuid as string;
  const cfg = (
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, is_primary) VALUES ($1,'waba','connected','+919811100001',true) RETURNING uuid`,
      [t.orgId],
    )
  ).rows[0].uuid as string;
  const contacts = await api.seedContacts(
    t,
    Array.from({ length: n }, (_, i) => ({
      name: `T${i}`,
      phone: `+91986${String(counter++).padStart(7, '0')}`,
    })),
  );
  for (const [i, uuid] of contacts.entries())
    await h.owner.query(`UPDATE contacts SET first_name = $1 WHERE uuid = $2`, [`Ana${i}`, uuid]);
  return { t, templateId, senderKey: `waba:${cfg}`, contacts };
}

async function sendBroadcast(a: {
  t: Tenant;
  templateId: string;
  senderKey: string;
  contacts: string[];
}) {
  const res = await api
    .http()
    .post('/v2/broadcasts')
    .set(bearer(a.t.admin))
    .set('idempotency-key', randomUUID())
    .send({
      name: 'Track',
      templateId: a.templateId,
      contactIds: a.contacts,
      senderKeys: [a.senderKey],
      scheduleType: 'now',
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = Number(
    (await h.owner.query(`SELECT id FROM broadcasts WHERE uuid = $1`, [res.body.broadcasts[0].id]))
      .rows[0].id,
  );
  await RequestContextStore.run(
    { requestId: `k-${id}`, orgId: a.t.orgId, actorType: 'system', actorId: null, userId: null },
    () => h.app.get(BroadcastDispatchService).run(a.t.orgId, id),
  );
  return { id, uuid: res.body.broadcasts[0].id as string };
}

const links = async (broadcastId: number) =>
  (
    await h.owner.query(
      `SELECT token, original_url, contact_id, clicks, unique_clicks, expires_at FROM wa_link_clicks WHERE broadcast_id = $1 ORDER BY id`,
      [broadcastId],
    )
  ).rows;

const tap = (path: string, ip = '203.0.113.7', ua = BROWSER) =>
  api.http().get(path).set('user-agent', ua).set('x-forwarded-for', ip).redirects(0);

const urlParam = (m: OutgoingMessage) =>
  (m.components as Array<{ type: string; parameters: Array<{ text: string }> }>).find(
    (c) => c.type === 'button',
  )?.parameters[0]?.text ?? '';

describe('WD-BCAST-018: wrapping', () => {
  it('each recipient gets their own short link in the URL button, and a row records who it belongs to', async () => {
    wabaSent = [];
    const a = await arrange('w1', 2);
    const b = await sendBroadcast(a);
    const params = wabaSent.map(urlParam);
    expect(params).toHaveLength(2);
    for (const p of params) expect(p).toMatch(/\/r\/[A-Za-z0-9]{12}$/);
    expect(new Set(params).size).toBe(2);

    const rows = await links(b.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.original_url)).toEqual([
      'https://shop.example.com/p/Ana0',
      'https://shop.example.com/p/Ana1',
    ]);
    expect(rows.every((r) => r.contact_id)).toBe(true);
    const days = (new Date(rows[0].expires_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
  });

  it('the same link for the same recipient in the same broadcast reuses its token; another broadcast gets a new one', async () => {
    const a = await arrange('w2', 1);
    const b = await sendBroadcast(a);
    const row = (await links(b.id))[0];
    const url = row.original_url as string;
    const ctx = { broadcastId: b.id, contactId: Number(row.contact_id) };
    const again = await db.txAs({ orgId: a.t.orgId }, (tx) =>
      tracker.wrap(tx, a.t.orgId, url, ctx),
    );
    expect(again.endsWith(`/r/${row.token}`)).toBe(true);
    expect(await links(b.id)).toHaveLength(1);

    const second = await sendBroadcast(a);
    const secondRow = (await links(second.id))[0];
    expect(secondRow.token).not.toBe(row.token);
  });

  it('leaves tel:, mailto:, a static (parameter-less) button and a link of ours alone', async () => {
    wabaSent = [];
    const a = await arrange('w3', 1, [
      { type: 'phone_number', value: 'tel:+911234567890' },
      { type: 'url', value: 'https://static.example.com' },
    ]);
    const b = await sendBroadcast(a);
    expect(await links(b.id)).toHaveLength(0);
    const ours = `${process.env.APP_URL?.replace(/\/+$/, '') ?? 'http://localhost:3000'}/r/abcdefghijkl`;
    const out = await db.txAs({ orgId: a.t.orgId }, async (tx) => [
      await tracker.wrap(tx, a.t.orgId, 'tel:+911234567890', {}),
      await tracker.wrap(tx, a.t.orgId, 'mailto:a@b.c', {}),
      await tracker.wrap(tx, a.t.orgId, ours, {}),
    ]);
    expect(out[0]).toBe('tel:+911234567890');
    expect(out[1]).toBe('mailto:a@b.c');
    expect(out[2]).toBe(ours);
  });

  it('wraps every link in a text body for the engines that send text', async () => {
    const a = await arrange('w4', 1);
    const body = await db.txAs({ orgId: a.t.orgId }, (tx) =>
      tracker.wrapText(tx, a.t.orgId, 'Buy https://a.test/x. Or https://b.test/y', {
        broadcastId: null,
        contactId: null,
      }),
    );
    expect(body).toMatch(/^Buy .*\/r\/[A-Za-z0-9]{12}\. Or .*\/r\/[A-Za-z0-9]{12}$/);
  });
});

describe('WD-BCAST-018: the redirect', () => {
  async function aLink() {
    wabaSent = [];
    const a = await arrange('r', 2);
    const b = await sendBroadcast(a);
    const rows = await links(b.id);
    return { a, b, rows, path: (i: number) => `/r/${rows[i].token}` };
  }

  it('a person taps it: 302 to the original, one click, the broadcast counts the contact, an event is written', async () => {
    const { a, b, rows, path } = await aLink();
    const res = await tap(path(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://shop.example.com/p/Ana0');
    const row = (
      await h.owner.query(
        `SELECT clicks, unique_clicks, first_click_at, last_click_at, last_ip, last_user_agent FROM wa_link_clicks WHERE token = $1`,
        [rows[0].token],
      )
    ).rows[0];
    expect(row).toMatchObject({ clicks: 1, unique_clicks: 1, last_ip: '203.0.113.7' });
    expect(row.first_click_at).not.toBeNull();
    expect(row.last_user_agent).toContain('iPhone');
    expect(
      Number(
        (await h.owner.query(`SELECT clicked_count FROM broadcasts WHERE id = $1`, [b.id])).rows[0]
          .clicked_count,
      ),
    ).toBe(1);
    expect((await api.events(a.t.orgId, 'broadcast.link_clicked')).length).toBe(1);
  });

  it('a link-preview crawler is redirected but nothing is counted', async () => {
    const { b, rows, path } = await aLink();
    for (const ua of ['WhatsApp/2.23.20 A', 'facebookexternalhit/1.1', 'curl/8.4.0']) {
      const res = await tap(path(0), '198.51.100.9', ua);
      expect(res.status).toBe(302);
    }
    expect((await links(b.id))[0].clicks).toBe(0);
    expect(
      Number(
        (await h.owner.query(`SELECT clicked_count FROM broadcasts WHERE id = $1`, [b.id])).rows[0]
          .clicked_count,
      ),
    ).toBe(0);
    expect(rows).toHaveLength(2);
  });

  it('a second tap from the same address counts a click, not a new unique visitor, and not a second contact click', async () => {
    const { b, path } = await aLink();
    await tap(path(0));
    await tap(path(0));
    const row = (await links(b.id))[0];
    expect(row).toMatchObject({ clicks: 2, unique_clicks: 1 });
    expect(
      Number(
        (await h.owner.query(`SELECT clicked_count FROM broadcasts WHERE id = $1`, [b.id])).rows[0]
          .clicked_count,
      ),
    ).toBe(1);
  });

  it('a different address on the same link is a new unique visitor but the same contact: the broadcast still counts one', async () => {
    const { b, path } = await aLink();
    await tap(path(0), '203.0.113.1');
    await tap(path(0), '203.0.113.2');
    expect((await links(b.id))[0]).toMatchObject({ clicks: 2, unique_clicks: 2 });
    expect(
      Number(
        (await h.owner.query(`SELECT clicked_count FROM broadcasts WHERE id = $1`, [b.id])).rows[0]
          .clicked_count,
      ),
    ).toBe(1);
  });

  it('two different contacts clicking counts two, and the detail shows the click-through rate over delivered (WD-BCAST-042)', async () => {
    const { a, b, path } = await aLink();
    await tap(path(0), '203.0.113.1');
    await tap(path(1), '203.0.113.2');
    expect(
      Number(
        (await h.owner.query(`SELECT clicked_count FROM broadcasts WHERE id = $1`, [b.id])).rows[0]
          .clicked_count,
      ),
    ).toBe(2);
    // Mark both as delivered so the rate has a base.
    await h.owner.query(
      `UPDATE broadcast_contacts SET status = 'delivered', delivered_at = now(), sent_at = now() WHERE broadcast_id = $1`,
      [b.id],
    );
    const d = (await api.http().get(`/v2/broadcasts/${b.uuid}`).set(bearer(a.t.admin))).body;
    expect(d.counts.clicked).toBe(2);
    expect(d.pct.clicked).toBe(100);
    const summary = (await api.http().get('/v2/broadcasts/summary').set(bearer(a.t.admin))).body;
    expect(summary.stats.clicked).toBe(2);
  });

  it('an expired link is 410, an unknown or malformed one is 404; no sign-in is needed', async () => {
    const { b, rows, path } = await aLink();
    await h.owner.query(
      `UPDATE wa_link_clicks SET expires_at = now() - interval '1 minute' WHERE token = $1`,
      [rows[0].token],
    );
    const gone = await tap(path(0));
    expect(gone.status).toBe(410);
    expect(gone.body.code).toBe('BCAST_LINK_EXPIRED');
    expect((await links(b.id))[0].clicks).toBe(0);
    expect((await tap('/r/Zz9Zz9Zz9Zz9')).status).toBe(404);
    expect((await tap('/r/not-a-token')).status).toBe(404);
  });

  it('the click is recorded under the owning organization only', async () => {
    const { a, rows, path } = await aLink();
    const other = await api.signup('rx');
    await tap(path(0));
    const owner = (
      await h.owner.query(`SELECT org_id FROM wa_link_clicks WHERE token = $1`, [rows[0].token])
    ).rows[0].org_id;
    expect(Number(owner)).toBe(a.t.orgId);
    expect(
      Number(
        (
          await h.owner.query(
            `SELECT count(*)::int AS n FROM broadcasts WHERE org_id = $1 AND clicked_count > 0`,
            [other.orgId],
          )
        ).rows[0].n,
      ),
    ).toBe(0);
  });
});
