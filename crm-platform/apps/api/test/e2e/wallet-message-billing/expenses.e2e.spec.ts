import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  expenseListResponseSchema,
  expenseSummaryResponseSchema,
  walletExactAmount,
} from '@crm/contracts';
import { bearer } from '../bsp-billing-engine/harness';
import {
  cleanWallet,
  fixedPricing,
  fund,
  newTenant,
  services,
  setPlan,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * The message expense log on the real schema, through the HTTP API a customer uses. A message's template and campaign name are copied
 * onto its charge when it settles, so the log keeps them after the template changes; the amounts come from the ledger, so a row and
 * its statement line show the same three or four decimals.
 */
let h: BspHarness;
let startedAt: Date;
let t: Tenant;
let empty: Tenant;

const get = (tenant: Tenant, path: string) =>
  h.api.http().get(`/v2/wallet${path}`).set(bearer(tenant.admin));

/** The amount the ledger holds for one message's charge, as the log should show it: positive, to the ledger's exact precision. */
async function ledgerCharge(orgId: number, wamid: string): Promise<string> {
  const r = await h.owner.query<{ amount: string }>(
    `SELECT amount::text AS amount FROM wallet_transactions WHERE org_id = $1 AND idempotency_key = $2`,
    [orgId, `charge:${wamid}`],
  );
  return walletExactAmount(r.rows[0]!.amount.replace(/^-/, ''));
}

const settle = (
  orgId: number,
  wamid: string,
  over: { templateName?: string | null; subjectName?: string | null; category?: string } = {},
) =>
  services(h).billing.settleDelivered({
    orgId,
    provider: 'waba',
    providerMessageId: wamid,
    recipient: '+919876543210',
    category: over.category ?? 'marketing',
    source: over.subjectName ? 'campaign' : 'chat',
    templateName: over.templateName ?? null,
    subjectName: over.subjectName ?? null,
  });

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  await fixedPricing(h);
  // Sign-up checks the mail domain by DNS and sends a WhatsApp code: the test domain takes no mail and there is no sender here, so
  // both are switched off the way the auth suites switch them off.
  await h.owner.query(
    `INSERT INTO platform_settings (key, value, is_secret) VALUES ('registration', $1::jsonb, false)
     ON CONFLICT (key) DO UPDATE SET value = platform_settings.value || $1::jsonb`,
    [
      JSON.stringify({
        businessEmailOnly: false,
        blockDisposableEmail: false,
        requirePhoneVerification: false,
      }),
    ],
  );
  t = await newTenant(h, 'expenses');
  empty = await newTenant(h, 'expenses-empty');
  // An ended plan has no allowance, so every delivered message is billed to the wallet and a free one can only be a wallet that is empty.
  for (const tenant of [t, empty])
    await setPlan(h, tenant.orgId, { planEndsAt: '2020-01-01T00:00:00Z' });
  await fund(h, t.orgId, 5000);
}, 120_000);

afterAll(async () => {
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('message expense log', () => {
  const ids = ['wamid.EXP.1', 'wamid.EXP.2', 'wamid.EXP.3'];

  beforeAll(async () => {
    await settle(t.orgId, ids[0]!, { templateName: 'order_update', subjectName: 'Diwali sale' });
    await settle(t.orgId, ids[1]!, { templateName: null, subjectName: null, category: 'utility' });
    await settle(t.orgId, ids[2]!, { templateName: 'order_update', subjectName: 'Diwali sale' });
    await services(h).billing.settleFailed(t.orgId, ids[2]!);
    // An empty wallet: the message is delivered but not billed, and the log says why.
    await settle(empty.orgId, 'wamid.EXP.FREE', {
      templateName: 'promo',
      subjectName: 'Winter promo',
    });
  }, 60_000);

  it('shows one row per message with its template, campaign name, amounts and status', async () => {
    const res = await get(t, '/expenses?limit=100');
    expect(res.status).toBe(200);
    const body = expenseListResponseSchema.parse(res.body);
    expect(body.currency).toBe('USD');
    const byId = new Map(body.data.map((r) => [r.id, r]));

    const first = byId.get(ids[0]!)!;
    expect(first).toMatchObject({
      status: 'charged',
      template: 'order_update',
      subjectName: 'Diwali sale',
      refundedMinor: 0,
      refundedAt: null,
    });
    expect(first.chargedExact).toBe(await ledgerCharge(t.orgId, ids[0]!));
    expect(first.netExact).toBe(first.chargedExact);

    // A message with no template (a chat text) has no name to show; it is not guessed from anything else.
    expect(byId.get(ids[1]!)).toMatchObject({
      template: null,
      subjectName: null,
      status: 'charged',
    });

    // A failed message: billed, then the same amount came back. Net is zero, and the refund time is set.
    const failed = byId.get(ids[2]!)!;
    expect(failed).toMatchObject({ status: 'refunded', template: 'order_update' });
    expect(failed.refundedExact).toBe(failed.chargedExact);
    expect(failed.netExact).toBe('0.00');
    expect(failed.refundedAt).not.toBeNull();
  });

  it('keeps a free message in the log with the reason it was free, and shows it to no one else', async () => {
    const free = expenseListResponseSchema.parse((await get(empty, '/expenses?limit=100')).body);
    expect(free.data.map((r) => r.id)).toEqual(['wamid.EXP.FREE']);
    expect(free.data[0]).toMatchObject({
      status: 'free',
      freeReason: 'wallet_empty',
      template: 'promo',
      chargedMinor: 0,
      chargedExact: '0.00',
    });

    const mine = expenseListResponseSchema.parse((await get(t, '/expenses?limit=100')).body);
    expect(mine.data.map((r) => r.id)).not.toContain('wamid.EXP.FREE');
  });

  it('filters by status, template and category', async () => {
    const refunded = expenseListResponseSchema.parse(
      (await get(t, '/expenses?status=refunded')).body,
    );
    expect(refunded.data.map((r) => r.id)).toEqual([ids[2]]);

    // Template matches whatever the case: the picker and the log may differ in capitals.
    const byTemplate = expenseListResponseSchema.parse(
      (await get(t, '/expenses?template=ORDER_UPDATE&limit=100')).body,
    );
    expect(byTemplate.data.map((r) => r.id).sort()).toEqual([ids[0], ids[2]].sort());

    const utility = expenseListResponseSchema.parse(
      (await get(t, '/expenses?category=utility&limit=100')).body,
    );
    expect(utility.data.map((r) => r.id)).toEqual([ids[1]]);
  });

  it('pages through every row without repeating one', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const qs = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = expenseListResponseSchema.parse((await get(t, `/expenses?limit=1${qs}`)).body);
      seen.push(...page.data.map((r) => r.id));
      cursor = page.page.nextCursor;
      if (!page.page.hasMore) break;
    }
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it('groups by template with totals over the whole filtered set', async () => {
    const res = await get(t, '/expenses/summary?groupBy=template');
    expect(res.status).toBe(200);
    const body = expenseSummaryResponseSchema.parse(res.body);
    expect(body.totals.messages).toBe(3);
    expect(body.totals.refunded).toBe(1);
    expect(body.totals.free).toBe(0);

    const orderUpdate = body.groups.find((g) => g.key === 'order_update')!;
    expect(orderUpdate.messages).toBe(2);
    expect(orderUpdate.refunded).toBe(1);
    // Two charges, one of them refunded in full: what is left is the first message's charge.
    expect(orderUpdate.netExact).toBe(await ledgerCharge(t.orgId, ids[0]!));

    // A message with no template is its own group, not dropped.
    expect(body.groups.find((g) => g.key === null)?.messages).toBe(1);
    const sumMessages = body.groups.reduce((n, g) => n + g.messages, 0);
    expect(sumMessages).toBe(body.totals.messages);
  });

  it('groups by category and by channel', async () => {
    const byCategory = expenseSummaryResponseSchema.parse(
      (await get(t, '/expenses/summary?groupBy=category')).body,
    );
    expect(byCategory.groups.map((g) => g.key).sort()).toEqual(['marketing', 'utility']);

    const bySource = expenseSummaryResponseSchema.parse(
      (await get(t, '/expenses/summary?groupBy=source')).body,
    );
    expect(bySource.groups.map((g) => g.key).sort()).toEqual(['campaign', 'chat']);
  });

  it('rejects a status it does not know', async () => {
    expect((await get(t, '/expenses?status=bogus')).status).toBe(422);
  });
});

describe('names for charges sent before the name was copied onto them', () => {
  let legacy: Tenant;

  beforeAll(async () => {
    legacy = await newTenant(h, 'expenses-legacy');
    const tpl = await h.owner.query<{ id: string }>(
      `INSERT INTO wa_templates (org_id, template_name, template_body, template_type, status, category)
       VALUES ($1, 'Old promo', 'Hello', 'standard', 'approved', 'marketing') RETURNING id`,
      [legacy.orgId],
    );
    const contact = await h.owner.query<{ id: string }>(
      `INSERT INTO contacts (org_id, name, phone) VALUES ($1, 'Legacy', '+919800000001') RETURNING id`,
      [legacy.orgId],
    );
    const bc = await h.owner.query<{ id: string }>(
      `INSERT INTO broadcasts (org_id, name, status, provider, template_id, total_recipients)
       VALUES ($1, 'Old broadcast', 'completed', 'waba', $2, 1) RETURNING id`,
      [legacy.orgId, tpl.rows[0]!.id],
    );
    await h.owner.query(
      `INSERT INTO broadcast_contacts (org_id, broadcast_id, contact_id, status, whatsapp_message_id)
       VALUES ($1, $2, $3, 'delivered', 'wamid.L.1')`,
      [legacy.orgId, bc.rows[0]!.id, contact.rows[0]!.id],
    );
    // Four charges with no name on them: the first has a broadcast that holds it, the second has none, the last two differ only in case.
    // Their names are set directly, as the settle path would have set them.
    const charge = (wamid: string, templateName: string | null) =>
      h.owner.query(
        `INSERT INTO usage_charges (org_id, wamid, status, free_reason, source, category, to_country, billing_mode, template_name)
         VALUES ($1, $2, 'free', 'rate_is_zero', 'broadcast', 'marketing', 'IN', 'plan', $3)`,
        [legacy.orgId, wamid, templateName],
      );
    await charge('wamid.L.1', null);
    await charge('wamid.L.2', null);
    await charge('wamid.L.3', 'Promo');
    await charge('wamid.L.4', 'promo');
  }, 60_000);

  it('shows the name the statement shows for a charge that has none, and none where there is no such message', async () => {
    const body = expenseListResponseSchema.parse((await get(legacy, '/expenses?limit=100')).body);
    const byId = new Map(body.data.map((r) => [r.id, r]));
    expect(byId.get('wamid.L.1')).toMatchObject({
      template: 'Old promo',
      subjectName: 'Old broadcast',
    });
    expect(byId.get('wamid.L.2')).toMatchObject({ template: null, subjectName: null });
  });

  it('groups a template whatever the case of its name, under one spelling', async () => {
    const body = expenseSummaryResponseSchema.parse(
      (await get(legacy, '/expenses/summary?groupBy=template')).body,
    );
    // The collation decides which spelling shows; the two names are one group either way.
    expect(body.groups.find((g) => g.key?.toLowerCase() === 'promo')?.messages).toBe(2);
    expect(body.groups.find((g) => g.key === 'Old promo')?.messages).toBe(1);
    expect(body.groups.find((g) => g.key === null)?.messages).toBe(1);
    expect(body.totals.messages).toBe(4);
  });

  it('filters by the name the statement shows, whatever its case', async () => {
    const body = expenseListResponseSchema.parse(
      (await get(legacy, '/expenses?template=OLD+PROMO&limit=100')).body,
    );
    expect(body.data.map((r) => r.id)).toEqual(['wamid.L.1']);
  });
});
