import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Mark as subscribed on the Consent card (the ledger write) also sets the channel's subscription label. The Subscription status card,
 * the contacts list and the segment filters read that label, not the ledger, so without it the card says No beside a Consent card that
 * says Subscribed. Real Postgres (restricted role, forced RLS), the real app.
 */
let h: Harness;
let api: Api;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
}, 300_000);
afterAll(async () => h?.stop());

const labelsOf = async (t: Tenant, uuid: string) =>
  (
    await h.owner.query(
      `SELECT whatsapp_subscription_status AS wa, email_subscription_status AS em,
              sms_subscription_status AS sms, is_unsubscribed
         FROM contacts WHERE org_id = $1 AND uuid = $2`,
      [t.orgId, uuid],
    )
  ).rows[0] as {
    wa: string | null;
    em: string | null;
    sms: string | null;
    is_unsubscribed: boolean;
  };

const createContact = async (t: Tenant, body: Record<string, unknown>) => {
  const res = await api.as(t.admin).post('/v2/contacts').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};

const record = async (t: Tenant, uuid: string, body: Record<string, unknown>) => {
  const res = await api
    .as(t.admin)
    .post(`/v2/contact-consent/contacts/${uuid}/events`)
    .set('idempotency-key', randomUUID())
    .send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
};

describe('Mark as subscribed sets the channel label the Subscription status card reads', () => {
  it('a marketing grant fills the blank WhatsApp label and the contact row reads subscribed', async () => {
    const t = await api.signup('ci-card-fill');
    const uuid = await createContact(t, { name: 'Richie', phone: '+919811000201' });
    expect((await labelsOf(t, uuid)).wa).toBeNull();

    await record(t, uuid, {
      action: 'granted',
      channel: 'whatsapp',
      source: 'manual',
      note: 'Signed the paper form',
    });

    expect(await labelsOf(t, uuid)).toMatchObject({ wa: 'subscribed', em: null, sms: null });
    const row = await api.as(t.admin).get(`/v2/contacts/${uuid}`);
    expect(row.body.whatsappSubscriptionStatus).toBe('subscribed');
  });

  it('a grant replaces a label that reads something else, on the channel granted only', async () => {
    const t = await api.signup('ci-card-replace');
    const uuid = await createContact(t, {
      name: 'Email Only',
      email: 'emailonly@example.com',
      phone: '+919811000202',
    });
    const current = await api.as(t.admin).get(`/v2/contacts/${uuid}`);
    const patched = await api
      .as(t.admin)
      .patch(`/v2/contacts/${uuid}`)
      .send({ rowVersion: current.body.rowVersion, emailSubscriptionStatus: 'unsubscribed' });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    await record(t, uuid, {
      action: 'granted',
      channel: 'email',
      source: 'manual',
      note: 'Ticked the newsletter box',
    });

    expect(await labelsOf(t, uuid)).toMatchObject({ em: 'subscribed', wa: null });
  });

  it('a withdrawal opts the contact out and leaves the label as it was', async () => {
    const t = await api.signup('ci-card-withdraw');
    const uuid = await createContact(t, { name: 'Out', phone: '+919811000203' });
    await record(t, uuid, {
      action: 'granted',
      channel: 'whatsapp',
      source: 'manual',
      note: 'Yes',
    });

    await record(t, uuid, { action: 'withdrawn', channel: 'whatsapp', source: 'manual' });

    expect(await labelsOf(t, uuid)).toMatchObject({ wa: 'subscribed', is_unsubscribed: true });
  });
});
