import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { SHOPIFY, type ShopifyFactory } from '../../../src/infra/providers/ecom/ecom.port';
import { ImportService } from '../../../src/modules/shopify-woocommerce/import.service';
import { AppointmentsApi, freshIp } from '../appointments-booking/support';
import { startAiStub, WidgetApi, type AiStub, type Tenant } from '../chatbot-widget/support';
import { startHarness, type Harness } from '../contacts-attributes-tags/support';

/**
 * Consent at intake, step 3 (BL-167): the versioned consent line of a chat widget, a booking type and a store, and the grants the
 * people who tick it (or the store's own marketing flag) leave in the ledger. POLICY: a first message or a booking alone grants nothing.
 * Real Postgres (restricted role, forced RLS), the real app.
 */
let h: Harness;
let api: WidgetApi;
let appts: AppointmentsApi;
let ai: AiStub;

beforeAll(async () => {
  ai = await startAiStub();
  process.env.WGT_AI_OPENAI_API_KEY = 'sk-test';
  process.env.WGT_AI_OPENAI_BASE_URL = ai.url;
  h = await startHarness();
  api = new WidgetApi(h);
  appts = new AppointmentsApi(h);
}, 300_000);

afterAll(async () => {
  await h?.stop();
  await ai?.stop();
  delete process.env.WGT_AI_OPENAI_API_KEY;
  delete process.env.WGT_AI_OPENAI_BASE_URL;
});

const ledger = async (t: Tenant, where = 'true') =>
  (
    await h.owner.query(
      `SELECT e.channel, e.action, e.source, e.note, e.evidence, c.email, c.phone
         FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        WHERE e.org_id = $1 AND ${where} ORDER BY e.channel, e.id`,
      [t.orgId],
    )
  ).rows as Array<{
    channel: string;
    action: string;
    source: string;
    note: string | null;
    evidence: Record<string, string>;
    email: string | null;
    phone: string | null;
  }>;

const putNotice = (t: Tenant, scope: string, ref: string, body: Record<string, unknown>) =>
  api
    .as(t.admin)
    .put(`/v2/contact-consent/notices/${scope}/${encodeURIComponent(ref)}`)
    .send(body);
const getNotice = (t: Tenant, scope: string, ref: string) =>
  api.as(t.admin).get(`/v2/contact-consent/notices/${scope}/${encodeURIComponent(ref)}`);

describe('the consent notice API', () => {
  it('versions the wording: a change appends the next version, a repeat writes nothing, bad input is refused', async () => {
    const t = await api.signup('cn-api');
    const w = await api.widget(t.admin, { name: 'Notice widget' });

    const none = await getNotice(t, 'widget', w.id);
    expect(none.status, JSON.stringify(none.body)).toBe(200);
    expect(none.body).toMatchObject({ enabled: false, text: '', version: 0 });

    const v1 = await putNotice(t, 'widget', w.id, {
      enabled: true,
      text: 'I agree to receive offers.',
      url: 'https://example.com/privacy',
    });
    expect(v1.status, JSON.stringify(v1.body)).toBe(200);
    expect(v1.body).toMatchObject({
      enabled: true,
      version: 1,
      url: 'https://example.com/privacy',
    });

    const again = await putNotice(t, 'widget', w.id, {
      enabled: true,
      text: 'I agree to receive offers.',
      url: 'https://example.com/privacy',
    });
    expect(again.body.version).toBe(1);

    const v2 = await putNotice(t, 'widget', w.id, {
      enabled: true,
      text: 'I agree to receive offers and news.',
      url: 'https://example.com/privacy',
    });
    expect(v2.body.version).toBe(2);
    const off = await putNotice(t, 'widget', w.id, {
      enabled: false,
      text: 'I agree to receive offers and news.',
      url: 'https://example.com/privacy',
    });
    expect(off.body).toMatchObject({ enabled: false, version: 3 });

    const rows = await h.owner.query(
      `SELECT version, enabled FROM consent_notices WHERE org_id = $1 ORDER BY version`,
      [t.orgId],
    );
    expect(rows.rows.map((r) => [r.version, r.enabled])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);

    // Switched on with no wording, a link that is not https, a scope or target that does not exist.
    expect((await putNotice(t, 'widget', w.id, { enabled: true, text: '  ' })).status).toBe(422);
    expect(
      (await putNotice(t, 'widget', w.id, { enabled: false, text: 'x', url: 'http://a.test' }))
        .status,
    ).toBe(422);
    const missing = await getNotice(t, 'widget', '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('CONSENT_NOTICE_TARGET_NOT_FOUND');
    expect((await getNotice(t, 'nonsense', w.id)).status).toBe(422);
  });

  it("another workspace cannot read or write a widget's notice, and a version row cannot be edited in the database", async () => {
    const a = await api.signup('cn-a');
    const b = await api.signup('cn-b');
    const w = await api.widget(a.admin, { name: 'A widget' });
    await putNotice(a, 'widget', w.id, { enabled: true, text: 'Agree' });
    expect((await getNotice(b, 'widget', w.id)).status).toBe(404);
    expect((await putNotice(b, 'widget', w.id, { enabled: true, text: 'Evil' })).status).toBe(404);
    await expect(
      h.owner.query(`UPDATE consent_notices SET text = 'changed' WHERE org_id = $1`, [a.orgId]),
    ).rejects.toThrow(/append-only/);
  });
});

describe('the website chat widget', () => {
  async function aiWidget(t: Tenant, over: Record<string, unknown> = {}) {
    const a = await api.assistant(t);
    return api.widget(t.admin, {
      name: 'Consent widget',
      mode: 'ai',
      assistantId: a.uuid,
      collectName: true,
      collectEmail: true,
      collectPhone: true,
      ...over,
    });
  }

  it('shows the line only when it is on and the form asks for a phone or an email; a first message grants nothing', async () => {
    const t = await api.signup('cw-cfg');
    const w = await aiWidget(t);
    const before = await api.pub(w.embedToken).config();
    expect(before.body.widget.consent ?? null).toBeNull();

    await putNotice(t, 'widget', w.id, { enabled: true, text: 'Send me offers on WhatsApp.' });
    const cfg = await api.pub(w.embedToken).config();
    expect(cfg.body.widget.consent).toEqual({
      text: 'Send me offers on WhatsApp.',
      version: 1,
      url: null,
    });

    // A visitor who just writes (even with a phone and an email) is NOT recorded as agreeing.
    const uuid = cfg.body.visitor.uuid as string;
    const sent = await api.pub(w.embedToken).message({
      body: 'hello',
      visitor_uuid: uuid,
      name: 'Plain Visitor',
      email: 'plain@example.com',
      phone: '+919800000001',
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(await ledger(t)).toHaveLength(0);

    // A widget that asks for neither does not offer the line.
    const noContact = await aiWidget(t, {
      name: 'Name only',
      collectEmail: false,
      collectPhone: false,
    });
    await putNotice(t, 'widget', noContact.id, { enabled: true, text: 'Agree' });
    const cfg2 = await api.pub(noContact.embedToken).config();
    expect(cfg2.body.widget.consent ?? null).toBeNull();
  });

  it('a visitor who ticks the box is recorded against the version they saw, on the channels they gave', async () => {
    const t = await api.signup('cw-grant');
    const w = await aiWidget(t);
    await putNotice(t, 'widget', w.id, {
      enabled: true,
      text: 'Send me offers on WhatsApp and email.',
      url: 'https://example.com/privacy',
    });
    const cfg = await api.pub(w.embedToken).config();
    const uuid = cfg.body.visitor.uuid as string;
    const res = await api.pub(w.embedToken).message({
      body: 'hi',
      visitor_uuid: uuid,
      name: 'Ticker',
      email: 'ticker@example.com',
      phone: '+919800000002',
      consent: true,
      consent_version: cfg.body.widget.consent.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const ev = await ledger(t);
    expect(ev.map((e) => [e.channel, e.action, e.source])).toEqual([
      ['email', 'granted', 'widget'],
      ['whatsapp', 'granted', 'widget'],
    ]);
    expect(ev[0]!.evidence).toMatchObject({
      widgetId: w.id,
      noticeVersion: '1',
      noticeUrl: 'https://example.com/privacy',
      consentText: 'Send me offers on WhatsApp and email.',
      consentVersion: '1',
    });
    expect(ev[0]!.evidence.consentHash).toMatch(/^[0-9a-f]{64}$/);
    // No IP, no user agent in the proof.
    expect(Object.keys(ev[0]!.evidence).sort()).toEqual([
      'consentHash',
      'consentText',
      'consentVersion',
      'noticeUrl',
      'noticeVersion',
      'widgetId',
    ]);

    // A second message from the same visitor with the same tick records nothing new.
    await api.pub(w.embedToken).message({
      body: 'again',
      visitor_uuid: uuid,
      consent: true,
      consent_version: 1,
    });
    expect(await ledger(t)).toHaveLength(2);
  });

  it('an invented version, a box ticked with no phone or email, and a switched-off line grant nothing', async () => {
    const t = await api.signup('cw-no');
    const w = await aiWidget(t);
    await putNotice(t, 'widget', w.id, { enabled: true, text: 'Send me offers.' });

    const u1 = (await api.pub(w.embedToken).config()).body.visitor.uuid as string;
    await api.pub(w.embedToken).message({
      body: 'x',
      visitor_uuid: u1,
      email: 'v1@example.com',
      consent: true,
      consent_version: 99,
    });
    const u2 = (await api.pub(w.embedToken).config()).body.visitor.uuid as string;
    await api.pub(w.embedToken).message({
      body: 'y',
      visitor_uuid: u2,
      name: 'No Contact Details',
      consent: true,
      consent_version: 1,
    });
    expect(await ledger(t)).toHaveLength(0);

    // The merchant switches the line off: a page that still shows v1 earns its visitor a grant (they did read it), but a visitor of the
    // new, line-less page cannot tick anything, and the config no longer offers it.
    await putNotice(t, 'widget', w.id, { enabled: false, text: 'Send me offers.' });
    const cfg = await api.pub(w.embedToken).config();
    expect(cfg.body.widget.consent ?? null).toBeNull();
  });

  it('does not override a STOP: a visitor who opted out and ticks the box again stays opted out', async () => {
    const t = await api.signup('cw-stop');
    const w = await aiWidget(t);
    await putNotice(t, 'widget', w.id, { enabled: true, text: 'Send me offers.' });
    const uuid = (await api.pub(w.embedToken).config()).body.visitor.uuid as string;
    await api
      .pub(w.embedToken)
      .message({ body: 'hi', visitor_uuid: uuid, email: 'stop@example.com' });
    const c = await h.owner.query(`SELECT id FROM contacts WHERE org_id = $1 AND email = $2`, [
      t.orgId,
      'stop@example.com',
    ]);
    const contactId = c.rows[0].id;
    await h.owner.query(
      `INSERT INTO contact_consent_events (org_id, contact_id, channel, purpose, action, source, idempotency_key)
       VALUES ($1,$2,'email','marketing','withdrawn','keyword','k-stop')`,
      [t.orgId, contactId],
    );
    await h.owner.query(
      `INSERT INTO contact_consent_state (org_id, contact_id, channel, purpose, state, last_event_id, last_occurred_at)
       SELECT org_id, contact_id, channel, purpose, 'withdrawn', id, occurred_at FROM contact_consent_events WHERE idempotency_key = 'k-stop'`,
    );
    await api.pub(w.embedToken).message({
      body: 'please',
      visitor_uuid: uuid,
      email: 'stop@example.com',
      consent: true,
      consent_version: 1,
    });
    const granted = (await ledger(t)).filter((e) => e.action === 'granted');
    expect(granted).toHaveLength(0);
  });
});

describe('the booking page', () => {
  it('the line is offered only when on; booking alone grants nothing; a ticked box records source booking with the version', async () => {
    const t = await appts.signup('cb-book');
    const type = await appts.type(t.admin, { name: 'Consent consult' });
    const bare = await appts
      .http()
      .get(`/v2/public/booking/${t.slug}/${type.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(bare.body.service.consent).toBeNull();

    const slots = await appts.publicSlots(t.slug, type.slug);
    expect(slots.length).toBeGreaterThan(5);

    // 1. Booked with no line on: a contact, but no consent.
    await appts.publicBooked(t.slug, type.slug, {
      startsAt: slots[0]!.start,
      name: 'Plain Booker',
      email: 'plainbooker@example.com',
      phone: '+919810000001',
    });
    expect(await ledger(t)).toHaveLength(0);

    await putNotice(t, 'booking', type.id, {
      enabled: true,
      text: 'Keep me posted about offers.',
      url: 'https://example.com/terms',
    });
    const shown = await appts
      .http()
      .get(`/v2/public/booking/${t.slug}/${type.slug}`)
      .set('x-forwarded-for', freshIp());
    expect(shown.body.service.consent).toEqual({
      text: 'Keep me posted about offers.',
      version: 1,
      url: 'https://example.com/terms',
    });

    // 2. The line is on but the box is not ticked: nothing.
    await appts.publicBooked(t.slug, type.slug, {
      startsAt: slots[1]!.start,
      name: 'Unticked',
      email: 'unticked@example.com',
      phone: '+919810000002',
      consent: { given: false, version: 1 },
    });
    // 3. An invented version: nothing.
    await appts.publicBooked(t.slug, type.slug, {
      startsAt: slots[2]!.start,
      name: 'Invented',
      email: 'invented@example.com',
      consent: { given: true, version: 42 },
    });
    expect(await ledger(t)).toHaveLength(0);

    // 4. Ticked at the real version.
    await appts.publicBooked(t.slug, type.slug, {
      startsAt: slots[3]!.start,
      name: 'Ticker',
      email: 'bookticker@example.com',
      phone: '+919810000004',
      consent: { given: true, version: 1 },
    });
    const ev = await ledger(t);
    expect(ev.map((e) => [e.channel, e.action, e.source])).toEqual([
      ['email', 'granted', 'booking'],
      ['whatsapp', 'granted', 'booking'],
    ]);
    expect(ev[0]!.evidence).toMatchObject({
      bookingTypeId: type.id,
      noticeVersion: '1',
      noticeUrl: 'https://example.com/terms',
      consentText: 'Keep me posted about offers.',
    });
  });
});

describe('Shopify marketing consent', () => {
  it("records the store's own marketing flag only when the merchant switched the store's consent line on, once per wording version", async () => {
    const t = await api.signup('cs-shop');
    const crypto = h.app.get(CryptoService, { strict: false });
    const imports = h.app.get(ImportService);
    const shopify = h.app.get<ShopifyFactory>(SHOPIFY);
    const customers = [
      {
        id: 1,
        first_name: 'Yes',
        email: 'yes@x.test',
        phone: '+91 98100 00011',
        email_marketing_consent: {
          state: 'subscribed',
          consent_updated_at: '2026-09-01T10:00:00Z',
        },
        sms_marketing_consent: { state: 'subscribed' },
      },
      {
        id: 2,
        first_name: 'Pending',
        email: 'pending@x.test',
        phone: '+91 98100 00012',
        email_marketing_consent: { state: 'pending' },
      },
      { id: 3, first_name: 'Silent', email: 'silent@x.test', phone: '+91 98100 00013' },
      {
        id: 4,
        first_name: 'Old',
        email: 'old@x.test',
        phone: '+91 98100 00014',
        accepts_marketing: true,
      },
    ];
    shopify.store = () =>
      ({
        shop: () => Promise.resolve({ ok: true, data: {} }),
        counts: () => Promise.resolve({ products: 0, orders: 0, customers: customers.length }),
        products: () => Promise.resolve({ items: [], complete: true }),
        orders: () => Promise.resolve({ items: [], complete: true }),
        customers: () => Promise.resolve({ items: customers, complete: true }),
        registerWebhooks: () => Promise.resolve({}),
        deleteWebhooks: () => Promise.resolve(),
      }) as never;
    const row = await h.owner.query(
      `INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_currency, access_token, webhook_secret)
       VALUES ($1, $2, 'consent-store.myshopify.com', 'Store', 'INR', $3, 'wh') RETURNING id, uuid`,
      [t.orgId, t.adminUserId, crypto.encrypt('shpat_x')],
    );
    const storeId = Number(row.rows[0].id);
    const ref = `shopify:${row.rows[0].uuid as string}`;

    // 1. The line is off: customers are mirrored, nothing is granted, whatever the store's flags say.
    await imports.run(t.orgId, 'shopify', storeId);
    expect(await ledger(t)).toHaveLength(0);
    const n = await h.owner.query(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(n.rows[0].n).toBe(4);

    // 2. The merchant says what the checkbox stands for (and that it covers WhatsApp too).
    const saved = await putNotice(t, 'commerce', ref, {
      enabled: true,
      text: 'At checkout you agreed to marketing by email, SMS and WhatsApp.',
      url: 'https://shop.example/policy',
      channels: ['whatsapp'],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    await imports.run(t.orgId, 'shopify', storeId);

    const ev = await ledger(t);
    const by = (email: string) =>
      ev.filter((e) => e.email === email).map((e) => `${e.channel}:${e.source}`);
    expect(by('yes@x.test')).toEqual(['email:commerce', 'sms:commerce', 'whatsapp:commerce']);
    expect(by('old@x.test')).toEqual(['email:commerce', 'whatsapp:commerce']);
    expect(by('pending@x.test')).toEqual([]);
    expect(by('silent@x.test')).toEqual([]);
    const yes = ev.find((e) => e.email === 'yes@x.test' && e.channel === 'email')!;
    expect(yes.evidence).toMatchObject({
      integrationId: ref,
      noticeVersion: '1',
      noticeUrl: 'https://shop.example/policy',
      storeFlag: 'email_marketing_consent',
    });
    const at = await h.owner.query(
      `SELECT occurred_at FROM contact_consent_events e JOIN contacts c ON c.org_id = e.org_id AND c.id = e.contact_id
        WHERE e.org_id = $1 AND c.email = 'yes@x.test' AND e.channel = 'email'`,
      [t.orgId],
    );
    expect(new Date(at.rows[0].occurred_at).toISOString()).toBe('2026-09-01T10:00:00.000Z');

    // 3. Syncing again records nothing new for the same wording.
    const total = ev.length;
    await imports.run(t.orgId, 'shopify', storeId);
    expect(await ledger(t)).toHaveLength(total);
  });
});
