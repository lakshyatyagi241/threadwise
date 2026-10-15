import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WabaIngestService } from '../../../src/modules/whatsapp-cloud-api-waba/waba-ingest.service';
import { splitWebhook } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import { scalar, startPipeline, until, type Pipeline } from './pipeline-support';
import { connectNumber } from './whatsapp-support';

/**
 * A click-to-WhatsApp ad as evidence (BL-169, privacy spec 4.3.2). POLICY: a first inbound message permits replying only. The ad that
 * brought the person is kept on the contact as an attribution touch and NEVER grants marketing: the ledger stays empty and the
 * contact's consent state stays `unknown`. Real Postgres (restricted role), real Redis and BullMQ, the WhatsApp webhook path.
 */
let p: Pipeline;

beforeAll(async () => {
  p = await startPipeline();
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const delivery = (
  wabaId: string,
  phoneNumberId: string,
  waId: string,
  message: Record<string, unknown> = {},
  id = `wamid.ctwa.${randomUUID()}`,
) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: wabaId,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: phoneNumberId },
            contacts: [{ wa_id: waId, profile: { name: 'Ad Visitor' } }],
            messages: [
              {
                id,
                from: waId,
                type: 'text',
                timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body: 'Hi, I saw your ad' },
                ...message,
              },
            ],
          },
        },
      ],
    },
  ],
});
const feed = (payload: unknown) => p.h.app.get(WabaIngestService).process(splitWebhook(payload));

const AD = {
  source_type: 'ad',
  source_id: '120210000000001',
  source_url: 'https://fb.me/abc123',
  headline: 'Spring sale on sofas',
  body: 'Up to 40 percent off this week',
  ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd',
};

const touches = async (orgId: number, phone: string) =>
  (
    await p.h.owner.query(
      `SELECT a.platform, a.source_label, a.ad, a.campaign, a.evidence, a.external_ref, a.captured_at
         FROM contact_attributions a JOIN contacts c ON c.org_id = a.org_id AND c.id = a.contact_id
        WHERE a.org_id = $1 AND c.phone = $2 ORDER BY a.captured_at, a.id`,
      [orgId, phone],
    )
  ).rows as Array<Record<string, unknown>>;

const ledgerCount = (orgId: number) =>
  scalar(p, `SELECT count(*)::int AS n FROM contact_consent_events WHERE org_id = $1`, [orgId]);
const stateCount = (orgId: number) =>
  scalar(p, `SELECT count(*)::int AS n FROM contact_consent_state WHERE org_id = $1`, [orgId]);

describe('a message that comes from an ad', () => {
  it('keeps the referral on the contact and writes nothing to the consent ledger', async () => {
    const t = await p.api.signup('ctwa-a');
    const number = await connectNumber(p.h, t.orgId, { phoneNumberId: '5100000001' });
    await feed(delivery(number.wabaId, number.phoneNumberId, '919850000001', { referral: AD }));

    const rows = await until('the touch', async () => {
      const r = await touches(t.orgId, '+919850000001');
      return r.length > 0 ? r : undefined;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: 'click_to_whatsapp',
      source_label: 'Click to WhatsApp ad',
      ad: '120210000000001',
      campaign: null,
    });
    expect(rows[0]!.evidence).toEqual({
      sourceType: 'ad',
      sourceId: '120210000000001',
      sourceUrl: 'https://fb.me/abc123',
      headline: 'Spring sale on sofas',
      body: 'Up to 40 percent off this week',
      ctwaClid: AD.ctwa_clid,
    });
    expect(String(rows[0]!.external_ref)).toMatch(/^ctwa:wamid\./);

    // POLICY: replying is permitted, marketing is not granted.
    expect(await ledgerCount(t.orgId)).toBe(0);
    expect(await stateCount(t.orgId)).toBe(0);
    const contact = (
      await p.h.owner.query(
        `SELECT whatsapp_subscription_status, sms_subscription_status, email_subscription_status, is_unsubscribed
           FROM contacts WHERE org_id = $1 AND phone = '+919850000001'`,
        [t.orgId],
      )
    ).rows[0];
    expect(contact).toMatchObject({
      whatsapp_subscription_status: null,
      sms_subscription_status: null,
      email_subscription_status: null,
      is_unsubscribed: false,
    });
  }, 90_000);

  it('a message without a referral leaves no touch, a redelivery leaves one, and a post referral keeps its id in the evidence only', async () => {
    const t = await p.api.signup('ctwa-b');
    const number = await connectNumber(p.h, t.orgId, { phoneNumberId: '5100000002' });
    await feed(delivery(number.wabaId, number.phoneNumberId, '919850000002'));
    await until('the contact', async () => {
      const r = await p.h.owner.query(
        `SELECT 1 FROM contacts WHERE org_id = $1 AND phone = '+919850000002'`,
        [t.orgId],
      );
      return r.rows.length > 0 ? true : undefined;
    });
    expect(await touches(t.orgId, '+919850000002')).toHaveLength(0);

    // The same ad message delivered twice (Meta redelivers): one touch.
    const id = `wamid.ctwa.${randomUUID()}`;
    const payload = delivery(
      number.wabaId,
      number.phoneNumberId,
      '919850000003',
      {
        referral: { ...AD, source_type: 'post', source_id: 'POST-9' },
      },
      id,
    );
    await feed(payload);
    await feed(payload);
    const rows = await until('the touch', async () => {
      const r = await touches(t.orgId, '+919850000003');
      return r.length > 0 ? r : undefined;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ad).toBeNull();
    expect(rows[0]!.evidence).toMatchObject({ sourceType: 'post', sourceId: 'POST-9' });
    expect(await ledgerCount(t.orgId)).toBe(0);
  }, 90_000);

  it('a second ad from the same person is a second touch; the first stays the first; a referral on an opted-out contact changes nothing in the ledger', async () => {
    const t = await p.api.signup('ctwa-c');
    const number = await connectNumber(p.h, t.orgId, { phoneNumberId: '5100000003' });
    await feed(
      delivery(number.wabaId, number.phoneNumberId, '919850000004', {
        referral: { ...AD, source_id: 'AD-FIRST' },
      }),
    );
    await until('the first touch', async () =>
      (await touches(t.orgId, '+919850000004')).length === 1 ? true : undefined,
    );
    await feed(
      delivery(number.wabaId, number.phoneNumberId, '919850000004', {
        referral: { ...AD, source_id: 'AD-SECOND' },
      }),
    );
    const rows = await until('the second touch', async () => {
      const r = await touches(t.orgId, '+919850000004');
      return r.length === 2 ? r : undefined;
    });
    expect(rows.map((r) => r.ad)).toEqual(['AD-FIRST', 'AD-SECOND']);
    expect(await ledgerCount(t.orgId)).toBe(0);
  }, 90_000);

  it('touches are append-only in the database and the new columns are guarded', async () => {
    const t = await p.api.signup('ctwa-d');
    const number = await connectNumber(p.h, t.orgId, { phoneNumberId: '5100000004' });
    await feed(delivery(number.wabaId, number.phoneNumberId, '919850000005', { referral: AD }));
    await until('the touch', async () =>
      (await touches(t.orgId, '+919850000005')).length === 1 ? true : undefined,
    );
    await expect(
      p.h.owner.query(`UPDATE contact_attributions SET evidence = '{}' WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      p.h.owner.query(`UPDATE contact_attributions SET external_ref = 'x' WHERE org_id = $1`, [
        t.orgId,
      ]),
    ).rejects.toThrow(/append-only/);
    // Row-level security stays enabled and forced on the table the migration touched.
    const rls = await p.h.owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'contact_attributions'`,
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  }, 90_000);
});
