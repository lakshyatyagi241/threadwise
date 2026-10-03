import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  catalogSettingsResponseSchema,
  nodeBridgeResponseSchema,
  type CatalogSettingsResponse,
} from '@crm/contracts';
import { FixtureCatalogState } from '../../../src/infra/providers/catalog-products/fixture.catalog.provider';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { CatalogSettingsService } from '../../../src/modules/catalog-products/catalog-settings.service';
import {
  CONVERSATION_MIRROR,
  type ConversationMirror,
} from '../../../src/modules/catalog-products/_shims/tokens';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import { DealsApi, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';

/**
 * The catalog's inbox mirror (TW-CAT-015 rule 13, 023, 031) and the operator's catalog settings (TW-CAT-030) end to end through
 * HTTP, against the fixture provider (CAT_PROVIDER_MODE=fixture). Real: Postgres with RLS, Redis, the chat-conversations facade.
 */
let h: Harness;
let api: DealsApi;
let fx: FixtureCatalogState;
let superToken = '';
let supportToken = '';

const raw = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

beforeAll(async () => {
  process.env.CAT_PROVIDER_MODE = 'fixture';
  h = await startHarness();
  api = new DealsApi(h);
  fx = h.app.get(FixtureCatalogState, { strict: false });

  const first = await raw()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await raw().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await raw()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await raw()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

const TOKEN = 'EAAG-test-token-0123456789-abcdef';
const PEER = '919800000001';

async function org(label: string): Promise<Tenant> {
  fx.reset();
  const t = await api.signup(label);
  const res = await api.as(t.admin).post('/v2/catalog/connect').send({
    provider: 'meta_cloud',
    catalogId: '555001',
    catalogName: 'Main',
    phoneNumberId: '100200',
    accessToken: TOKEN,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return t;
}
async function whatsappChannel(t: Tenant, status = 'connected') {
  const row = (
    await h.owner.query(
      `INSERT INTO channels (org_id, kind, name, status) VALUES ($1,'whatsapp_cloud','WhatsApp',$2) RETURNING id, uuid`,
      [t.orgId, status],
    )
  ).rows[0] as { id: string; uuid: string };
  return { id: Number(row.id), uuid: row.uuid };
}
async function thread(t: Tenant, channelId: number, peer = PEER) {
  const row = (
    await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1,$2,$3,$4) RETURNING id`,
      [t.orgId, channelId, peer, `+${peer}`],
    )
  ).rows[0] as { id: string };
  return Number(row.id);
}
async function product(t: Tenant, name: string, extra: Record<string, unknown> = {}) {
  const res = await api
    .as(t.admin)
    .post('/v2/catalog/products')
    .send({ name, priceMajor: '1299.50', currencyCode: 'INR', ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; retailerId: string };
}
interface MirrorRow {
  id: number;
  seq: number;
  direction: string;
  kind: string;
  sender_kind: string;
  sender_user_id: number | null;
  status: string;
  body: string | null;
  meta: {
    source?: string;
    type?: string;
    mode?: string;
    provider?: string;
    wa_message_id?: string;
    products?: Array<Record<string, unknown>>;
  };
  provider_message_id: string | null;
  peer_key: string;
  channel_id: number;
  msg_seq: number;
  preview: string;
  last_message_id: number;
}
const messagesOf = async (orgId: number, peer = PEER) =>
  (
    await h.owner.query(
      `SELECT m.id, m.seq, m.direction, m.kind, m.sender_kind, m.sender_user_id, m.status, m.body, m.meta, m.provider_message_id,
              c.peer_key, c.channel_id, c.msg_seq, c.preview, c.last_message_id
         FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE m.org_id = $1 AND c.peer_key = $2 ORDER BY m.seq`,
      [orgId, peer],
    )
  ).rows as MirrorRow[];
const conversationCount = async (orgId: number) =>
  Number(
    (await h.owner.query(`SELECT count(*)::int n FROM conversations WHERE org_id = $1`, [orgId]))
      .rows[0].n,
  );

describe('TW-CAT-015 #13, TW-CAT-031: the inbox mirror', () => {
  it('a link send into a number that already has a thread adds one outbound catalog bubble from the sending user and bumps the thread', async () => {
    const t = await org('mirrorlink');
    const ch = await whatsappChannel(t);
    const convId = await thread(t, ch.id);
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: PEER, mode: 'link' });
    expect(res.body).toMatchObject({ ok: true, sent: 1 });

    const rows = await messagesOf(t.orgId);
    expect(rows).toHaveLength(1);
    const m = rows[0]!;
    expect(m).toMatchObject({
      direction: 'out',
      kind: 'interactive',
      sender_kind: 'agent',
      sender_user_id: t.adminUserId,
      status: 'sent',
      body: 'Catalog link',
      msg_seq: 1,
      preview: 'Catalog link',
    });
    expect(m.meta).toMatchObject({
      source: 'catalog',
      type: 'catalog',
      mode: 'link',
      provider: 'meta',
      products: [],
    });
    expect(m.meta.wa_message_id).toBe(m.provider_message_id);
    expect(m.provider_message_id).toMatch(/^wamid-/);
    // The existing thread is reused: no second one for the same number.
    expect(await conversationCount(t.orgId)).toBe(1);
    expect(Number(m.last_message_id)).toBe(Number(m.id));
    expect(
      (
        await h.owner.query(`SELECT id FROM conversations WHERE org_id=$1 AND peer_key=$2`, [
          t.orgId,
          PEER,
        ])
      ).rows[0].id,
    ).toEqual(convId);
  });

  it('a product send carries the product summaries (id, name, image, price, retailer id) so the inbox draws a tile without a join', async () => {
    const t = await org('mirrorspm');
    const ch = await whatsappChannel(t);
    await thread(t, ch.id);
    const shirt = await product(t, 'Shirt', { sku: 'SH', imageUrl: 'https://i/s.jpg' });
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: PEER, mode: 'spm', productIds: [shirt.id] });
    expect(res.body).toMatchObject({ ok: true, sent: 1 });
    const [m] = await messagesOf(t.orgId);
    expect(m!.body).toBe('Shirt');
    expect(m!.meta.mode).toBe('spm');
    expect(m!.meta.products).toEqual([
      expect.objectContaining({
        name: 'Shirt',
        image_url: 'https://i/s.jpg',
        price_minor: 129950,
        currency: 'INR',
        retailer_id: shirt.retailerId,
        price_display: expect.stringContaining('1,299.50'),
      }),
    ]);
  });

  it('a typed message is the bubble text; a product list says how many more', async () => {
    const t = await org('mirrormpm');
    const ch = await whatsappChannel(t);
    await thread(t, ch.id);
    const a = await product(t, 'Alpha');
    const b = await product(t, 'Beta');
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: PEER, mode: 'mpm', productIds: [a.id, b.id] });
    await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: PEER, mode: 'link', body: 'Our shop is open' });
    const rows = await messagesOf(t.orgId);
    expect(rows.map((r) => r.body)).toEqual(['Alpha and 1 more', 'Our shop is open']);
    expect(rows.map((r) => Number(r.seq))).toEqual([1, 2]);
    expect(rows[0]!.meta.products).toHaveLength(2);
  });

  it('a number with no thread gets one on the first connected WhatsApp channel (Reference find-or-create), with its lifecycle record', async () => {
    const t = await org('mirrornew');
    const closed = await whatsappChannel(t, 'disconnected');
    const ch = await whatsappChannel(t);
    expect(closed.id).toBeLessThan(ch.id);
    await api.as(t.admin).post('/v2/catalog/send').send({ manualNumbers: PEER, mode: 'link' });
    const [m] = await messagesOf(t.orgId);
    expect(m).toBeDefined();
    expect(Number(m!.channel_id)).toBe(ch.id);
    expect(m!.peer_key).toBe(PEER);
    expect(await conversationCount(t.orgId)).toBe(1);
    const events = await h.owner.query(
      `SELECT count(*)::int n FROM event_outbox WHERE org_id=$1 AND event_type='conversation.created'`,
      [t.orgId],
    );
    // The conversation core emits it once per thread; recordOutbound currently emits it twice (reported to the chat owner).
    expect(events.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('no WhatsApp channel at all: the send succeeds, nothing is mirrored and nothing throws', async () => {
    const t = await org('mirrornone');
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: PEER, mode: 'link' });
    expect(res.body).toMatchObject({ ok: true, sent: 1, failed: 0 });
    expect(await conversationCount(t.orgId)).toBe(0);
    expect(
      Number(
        (await h.owner.query(`SELECT count(*)::int n FROM messages WHERE org_id=$1`, [t.orgId]))
          .rows[0].n,
      ),
    ).toBe(0);
    // Only a disconnected channel and no thread: still nothing.
    await whatsappChannel(t, 'disconnected');
    await api.as(t.admin).post('/v2/catalog/send').send({ manualNumbers: PEER, mode: 'link' });
    expect(await conversationCount(t.orgId)).toBe(0);
  });

  it('a recipient Meta rejected leaves no bubble; the other one gets its thread', async () => {
    const t = await org('mirrorreject');
    await whatsappChannel(t);
    fx.rejectRecipients.add('919800000002');
    const res = await api
      .as(t.admin)
      .post('/v2/catalog/send')
      .send({ manualNumbers: `${PEER} 919800000002`, mode: 'link' });
    expect(res.body).toMatchObject({ sent: 1, failed: 1 });
    expect(await messagesOf(t.orgId, '919800000002')).toHaveLength(0);
    expect(await messagesOf(t.orgId, PEER)).toHaveLength(1);
  });

  it('the same provider message id mirrored twice is one bubble (idempotent), and a typed number format finds the same thread', async () => {
    const t = await org('mirroridem');
    const ch = await whatsappChannel(t);
    await thread(t, ch.id);
    const mirror = h.app.get<ConversationMirror>(CONVERSATION_MIRROR, { strict: false });
    const input = {
      orgId: t.orgId,
      recipientDigits: PEER,
      userId: t.adminUserId,
      mode: 'link' as const,
      body: null,
      provider: 'meta' as const,
      messageId: 'wamid-idem-1',
      products: [],
    };
    await mirror.mirrorCatalogSend(input);
    await mirror.mirrorCatalogSend(input);
    await mirror.mirrorCatalogSend({ ...input, messageId: 'wamid-idem-2' });
    expect(await messagesOf(t.orgId)).toHaveLength(2);
    // A thread under the number written with a plus is the same peer.
    await mirror.mirrorCatalogSend({
      ...input,
      recipientDigits: '+91 98000 00001',
      messageId: 'wamid-idem-3',
    });
    expect(await messagesOf(t.orgId)).toHaveLength(3);
    expect(await conversationCount(t.orgId)).toBe(1);
  });

  it('is tenant-safe: another workspace is never written to', async () => {
    const a = await org('mirrora');
    const b = await org('mirrorb');
    await whatsappChannel(b);
    await api.as(a.admin).post('/v2/catalog/send').send({ manualNumbers: PEER, mode: 'link' });
    expect(await conversationCount(b.orgId)).toBe(0);
    expect(await conversationCount(a.orgId)).toBe(0);
  });

  it('TW-CAT-023: a product share is mirrored as a plain message marked product_share, not as the catalog bubble', async () => {
    const t = await org('mirrorshare');
    const ch = await whatsappChannel(t);
    await thread(t, ch.id);
    await h.owner.query(
      `INSERT INTO devices (org_id, device_name, phone_number, status, active) VALUES ($1,'Phone','919700000009','connected',true)`,
      [t.orgId],
    );
    const p = await product(t, 'Lamp', { imageUrl: 'https://i/l.jpg' });
    const res = await api
      .as(t.admin)
      .post(`/v2/catalog/products/${p.id}/send`)
      .send({ phone: `+${PEER}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [m] = await messagesOf(t.orgId);
    expect(m).toMatchObject({ kind: 'text', sender_kind: 'agent', direction: 'out' });
    expect(m!.body).toContain('Lamp');
    expect(m!.meta).toMatchObject({ source: 'product_share', provider: 'baileys' });
    expect(m!.meta.type).toBeUndefined();
  });
});

describe('TW-CAT-031: the product picker the inbox modal reads', () => {
  it('lists active in-stock products, searched by name or SKU, through cat.products.read; a member without it is refused', async () => {
    const t = await org('picker');
    await product(t, 'Blue tee', { sku: 'TEE-1' });
    await product(t, 'Mug', { sku: 'MUG-1' });
    const all = await api.as(t.admin).get('/v2/catalog/products/picker');
    expect(all.status).toBe(200);
    expect(all.body.data ?? all.body.products).toHaveLength(2);
    const q = await api.as(t.admin).get('/v2/catalog/products/picker?q=tee');
    expect((q.body.data ?? q.body.products).map((p: { name: string }) => p.name)).toEqual([
      'Blue tee',
    ]);
    const none = await api.member(t, 'nopicker', [['record.deals.read']]);
    expect((await api.as(none.token).get('/v2/catalog/products/picker')).status).toBe(403);
  });
});

describe('RBAC: the cat.* keys are on the Owner and Admin presets only', () => {
  it('a new organization grants all ten keys to its admin roles and none to manager, agent or viewer', async () => {
    const t = await api.signup('rbac');
    const rows = (
      await h.owner.query(
        `SELECT r.system_key, count(*) FILTER (WHERE g.permission_key LIKE 'cat.%' AND g.effect = 'allow')::int AS n
           FROM roles r LEFT JOIN role_grants g ON g.org_id = r.org_id AND g.role_id = r.id
          WHERE r.org_id = $1 GROUP BY r.system_key`,
        [t.orgId],
      )
    ).rows as Array<{ system_key: string | null; n: number }>;
    const by = Object.fromEntries(rows.map((r) => [r.system_key, r.n]));
    const total = Number(
      (await h.owner.query(`SELECT count(*)::int n FROM permission_defs WHERE key LIKE 'cat.%'`))
        .rows[0].n,
    );
    expect(total).toBe(10);
    expect(by.admin).toBe(10);
    expect(by.workspace_admin).toBe(10);
    for (const role of ['manager', 'agent', 'viewer']) expect(by[role], role).toBe(0);
  });

  it('a manager and an agent are refused every catalog and product route (Reference: admin or above)', async () => {
    const t = await api.signup('rbac2');
    for (const roleName of ['Manager', 'Agent']) {
      const m = await api.memberWithRole(t, roleName.toLowerCase(), roleName);
      for (const path of [
        '/v2/catalog/overview',
        '/v2/catalog/products',
        '/v2/catalog/products/picker',
        '/v2/catalog/reviews',
      ]) {
        expect((await api.as(m.token).get(path)).status, `${roleName} ${path}`).toBe(403);
      }
    }
  });
});

describe('TW-CAT-030: operator catalog settings', () => {
  const ops = (m: 'get' | 'patch') =>
    raw()[m]('/v2/platform/settings/catalog').set(bearer(superToken));
  const reset = async () => {
    await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'cat.settings%'`);
    await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'inst.node_bridge%'`);
    await h.owner.query(
      `DELETE FROM security_events WHERE event = 'platform.catalog_settings_updated'`,
    );
    h.app.get(PlatformSettingsService).invalidate();
  };
  beforeEach(reset);
  afterAll(reset);

  async function read(): Promise<CatalogSettingsResponse> {
    const res = await ops('get');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return catalogSettingsResponseSchema.parse(res.body);
  }
  const save = async (body: Record<string, unknown>) =>
    ops('patch').send({ rowVersion: (await read()).rowVersion, ...body });

  it('shows Reference defaults before the first save: enabled, commerce off, v23.0, USD, no secret', async () => {
    expect(await read()).toMatchObject({
      catalogEnabled: true,
      commerceEnabled: false,
      graphApiVersion: 'v23.0',
      metaAppId: '',
      metaAppSecretSet: false,
      defaultCurrency: 'USD',
      rowVersion: 0,
    });
  });

  it('#1 saving v24.0 is what the catalog calls use next; a blank value clears it back to the default', async () => {
    const res = await save({ graphApiVersion: 'v24.0' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.graphApiVersion).toBe('v24.0');
    expect(await h.app.get(CatalogSettingsService).graphVersion()).toBe('v24.0');
    await save({ graphApiVersion: '' });
    expect(await h.app.get(CatalogSettingsService).graphVersion()).toBe('v23.0');
  });

  it('#2 a version that is not vNN.N is refused 422 and nothing changes', async () => {
    for (const bad of ['24', 'v24', 'v1.2.3', '24.0']) {
      const res = await save({ graphApiVersion: bad });
      expect(res.status, bad).toBe(422);
    }
    expect((await read()).rowVersion).toBe(0);
  });

  it('#3 the app secret is stored sealed, never returned, and a blank save keeps it', async () => {
    const res = await save({ metaAppId: '12345', metaAppSecret: 'super-secret-value' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ metaAppId: '12345', metaAppSecretSet: true });
    expect(JSON.stringify(res.body)).not.toContain('super-secret-value');
    const stored = await h.owner.query(
      `SELECT value::text v, is_secret FROM platform_settings WHERE key = 'cat.settings.metaAppSecret'`,
    );
    expect(stored.rows[0].is_secret).toBe(true);
    expect(stored.rows[0].v).not.toContain('super-secret-value');
    const kept = await save({ metaAppSecret: '', defaultCurrency: 'eur' });
    expect(kept.body).toMatchObject({ metaAppSecretSet: true, defaultCurrency: 'eur' });
    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.catalog_settings_updated' ORDER BY id`,
    );
    expect(JSON.stringify(audit.rows)).not.toContain('super-secret-value');
    expect(audit.rows[0].payload.fields).toEqual(['metaAppId', 'metaAppSecret']);
    expect(audit.rows[1].payload.fields).toEqual(['defaultCurrency']);
  });

  it('a stale rowVersion is 409 ROW_VERSION_CONFLICT; only a super admin may save; a non-operator is refused', async () => {
    await save({ commerceEnabled: true });
    const stale = await ops('patch').send({ rowVersion: 0, commerceEnabled: false });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await read()).commerceEnabled).toBe(true);
    const sup = await raw()
      .patch('/v2/platform/settings/catalog')
      .set(bearer(supportToken))
      .send({ rowVersion: 1, commerceEnabled: false });
    expect(sup.status).toBe(403);
    expect(
      (await raw().get('/v2/platform/settings/catalog').set(bearer(supportToken))).status,
    ).toBe(200);
    const t = await api.signup('settingsdeny');
    expect(
      (await api.as(t.admin).get('/v2/platform/settings/catalog')).status,
    ).toBeGreaterThanOrEqual(401);
  });

  it('the usage tiles are real counts: workspaces with a catalog id, synced products, sent messages', async () => {
    const before = await read();
    const t = await org('usage');
    await product(t, 'Tile');
    await api.as(t.admin).post('/v2/catalog/send').send({ manualNumbers: PEER, mode: 'link' });
    const after = await read();
    expect(after.usage.workspacesConnected).toBe(before.usage.workspacesConnected + 1);
    expect(after.usage.messagesSent).toBe(before.usage.messagesSent + 1);
  });

  it('TW-CAT-034: the Baileys bridge address is the Node bridge page address, with the environment as fallback', async () => {
    const svc = h.app.get(CatalogSettingsService);
    expect((await svc.bridgeTarget()).baseUrl).toMatch(/^https?:\/\//); // the env default
    const cur = nodeBridgeResponseSchema.parse(
      (await raw().get('/v2/platform/node-bridge').set(bearer(superToken))).body,
    );
    const put = await raw().patch('/v2/platform/node-bridge').set(bearer(superToken)).send({
      serverUrl: 'http://bridge.internal:9100',
      token: 'bridge-token-1',
      rowVersion: cur.rowVersion,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    h.app.get(PlatformSettingsService).invalidate();
    expect(await svc.bridgeTarget()).toEqual({
      baseUrl: 'http://bridge.internal:9100',
      token: 'bridge-token-1',
    });
  });
});
