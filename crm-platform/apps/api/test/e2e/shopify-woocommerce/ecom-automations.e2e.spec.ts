import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from '../auth-registration-security/harness';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

/** A store's automations: list, save, validation and tenant isolation (TW-ECOM-009, 033), against a real Postgres. */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h as never);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function store(t: Tenant, kind: 'shopify' | 'woocommerce'): Promise<string> {
  const secret = randomBytes(20).toString('hex');
  const r =
    kind === 'shopify'
      ? await h.owner.query(
          `INSERT INTO shopify_integrations (org_id, user_id, store_url, access_token, webhook_secret)
           VALUES ($1, $2, $3, 'x', $4) RETURNING uuid`,
          [t.orgId, t.adminUserId, `${secret.slice(0, 6)}.myshopify.com`, secret],
        )
      : await h.owner.query(
          `INSERT INTO woocommerce_integrations (org_id, user_id, store_url, consumer_key, consumer_secret, webhook_secret)
           VALUES ($1, $2, $3, 'k', 's', $4) RETURNING uuid`,
          [t.orgId, t.adminUserId, `https://${secret.slice(0, 6)}.test`, secret],
        );
  return r.rows[0].uuid as string;
}

async function template(t: Tenant): Promise<string> {
  const r = await h.owner.query(
    `INSERT INTO wa_templates (org_id, user_id, template_name, template_body, language, channel)
     VALUES ($1, $2, $3, 'Hi {{1}}', 'en_US', 'whatsapp') RETURNING uuid`,
    [t.orgId, t.adminUserId, `tpl_${randomBytes(4).toString('hex')}`],
  );
  return r.rows[0].uuid as string;
}

const url = (kind: string, id: string) => `/v2/${kind}/stores/${id}/automations`;

describe("reading a store's automations", () => {
  it('lists every supported event, all off, for a store never set up', async () => {
    const t = await api.signup('eau1');
    const id = await store(t, 'shopify');
    const res = await api.http().get(url('shopify', id)).set(bearer(t.admin));
    expect(res.status).toBe(200);
    expect(res.body.automations).toHaveLength(16);
    expect(res.body.automations.every((a: { isActive: boolean }) => !a.isActive)).toBe(true);
    const woo = await api
      .http()
      .get(url('woocommerce', await store(t, 'woocommerce')))
      .set(bearer(t.admin));
    expect(woo.body.automations).toHaveLength(21);
    expect(woo.body.senderKey).toBeNull();
  });

  it("is 404 for another workspace's store", async () => {
    const t = await api.signup('eau2');
    const other = await api.signup('eau3');
    const id = await store(other, 'shopify');
    expect((await api.http().get(url('shopify', id)).set(bearer(t.admin))).status).toBe(404);
  });
});

describe('saving automations', () => {
  it('saves a mapping, keeps it on the next read and ignores an unsupported event', async () => {
    const t = await api.signup('eau4');
    const id = await store(t, 'shopify');
    const tpl = await template(t);
    const res = await api
      .http()
      .put(url('shopify', id))
      .set(bearer(t.admin))
      .send({
        automations: [
          {
            eventType: 'orders/create',
            isActive: true,
            templateUuid: tpl,
            varMap: ['name', 'order_name'],
            sendTo: 'both',
            adminNumber: '+91 98765 43210',
            delaySeconds: 0,
          },
          { eventType: 'nope/never', isActive: true, templateUuid: tpl },
        ],
      });
    expect(res.status).toBe(200);
    const a = res.body.automations.find(
      (x: { eventType: string }) => x.eventType === 'orders/create',
    );
    expect(a).toMatchObject({
      isActive: true,
      templateUuid: tpl,
      varMap: ['name', 'order_name'],
      sendTo: 'both',
      adminNumber: '+91 98765 43210',
    });
    expect(
      res.body.automations.some((x: { eventType: string }) => x.eventType === 'nope/never'),
    ).toBe(false);
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM shopify_integration_events WHERE org_id = $1`,
      [t.orgId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('refuses an unknown template, and an automation turned on without one', async () => {
    const t = await api.signup('eau5');
    const id = await store(t, 'shopify');
    const unknown = await api
      .http()
      .put(url('shopify', id))
      .set(bearer(t.admin))
      .send({
        automations: [{ eventType: 'orders/create', isActive: false, templateUuid: randomUUID() }],
      });
    expect(unknown.status).toBe(422);
    const none = await api
      .http()
      .put(url('shopify', id))
      .set(bearer(t.admin))
      .send({ automations: [{ eventType: 'orders/create', isActive: true, templateUuid: null }] });
    expect(none.status).toBe(422);
  });

  it("refuses another workspace's template", async () => {
    const t = await api.signup('eau6');
    const other = await api.signup('eau7');
    const id = await store(t, 'woocommerce');
    const theirs = await template(other);
    const res = await api
      .http()
      .put(url('woocommerce', id))
      .set(bearer(t.admin))
      .send({
        automations: [{ eventType: 'order.created', isActive: true, templateUuid: theirs }],
      });
    expect(res.status).toBe(422);
  });

  it('stores a WooCommerce "send from" only for a connected number of this workspace, and clears it with null', async () => {
    const t = await api.signup('eau8');
    const id = await store(t, 'woocommerce');
    const bad = await api
      .http()
      .put(url('woocommerce', id))
      .set(bearer(t.admin))
      .send({ automations: [], senderKey: `waba:${randomUUID()}` });
    expect(bad.status).toBe(422);
    const cfg = await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status) VALUES ($1, 'waba', 'connected') RETURNING uuid`,
      [t.orgId],
    );
    const key = `waba:${cfg.rows[0].uuid}`;
    const ok = await api
      .http()
      .put(url('woocommerce', id))
      .set(bearer(t.admin))
      .send({ automations: [], senderKey: key });
    expect(ok.body.senderKey).toBe(key);
    const kept = await api
      .http()
      .put(url('woocommerce', id))
      .set(bearer(t.admin))
      .send({ automations: [] });
    expect(kept.body.senderKey).toBe(key);
    const cleared = await api
      .http()
      .put(url('woocommerce', id))
      .set(bearer(t.admin))
      .send({ automations: [], senderKey: null });
    expect(cleared.body.senderKey).toBeNull();
  });
});
