import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  USAGE_REPORTED_EVENT,
  expenseListResponseSchema,
  expenseSummaryResponseSchema,
  walletUsageSettingsSchema,
} from '@crm/contracts';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
import { emitUsageReported } from '../../../src/kernel/outbox/usage-report';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import { UsageBillingConsumer } from '../../../src/modules/wallet-message-billing/usage.consumer';
import { WalletLogService } from '../../../src/modules/wallet-message-billing/wallet-log.service';
import type { WalletRealtimePublisher } from '../../../src/modules/wallet-message-billing/wallet-realtime.publisher';
import { bearer } from '../bsp-billing-engine/harness';
import {
  balanceMinor,
  charges,
  cleanWallet,
  events,
  fund,
  ledgerRows,
  newTenant,
  services,
  setPlan,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * Everything that draws on the wallet besides a WhatsApp message, on the real schema: SMS, email, calls, AI, translation, lookups.
 * One report becomes one charge: priced from the operator's prices, taken from the wallet once, written to the customer's expense
 * log with its kind and units, and given back when the work failed. Defaults of a fresh install: SMS 0.50 a segment, email 0.10,
 * a call 1.00 a minute, AI and translation at the vendor's cost plus 10%.
 */
let h: BspHarness;
let startedAt: Date;
let n = 0;
const id = (p: string) => `${p}.${Date.now()}.${n++}`;

const report = (
  orgId: number,
  over: Partial<Parameters<ReturnType<typeof services>['usage']['settle']>[0]> & {
    kind: Parameters<ReturnType<typeof services>['usage']['settle']>[0]['kind'];
  },
) =>
  services(h).usage.settle({
    orgId,
    usageId: id(over.kind),
    status: 'used',
    units: 1,
    ...over,
  });

async function tenant(label: string): Promise<Tenant> {
  return newTenant(h, label);
}

/** Drops the prices an earlier test saved, and every cache that would still hold them. */
async function resetRates() {
  await h.owner.query(`DELETE FROM platform_settings WHERE key = 'wallet.usage_rates'`);
  services(h).settings.invalidate();
  services(h).usageSettings.invalidate();
}

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  await resetRates();
}, 120_000);

afterAll(async () => {
  await cleanWallet(h, startedAt);
  await h.stop();
});

beforeEach(resetRates);

describe('unit-priced usage', () => {
  it('charges an SMS per segment, once, and writes the expense row with its kind and units', async () => {
    const t = await tenant('sms1');
    await fund(h, t.orgId, 1000);
    const usageId = id('SM');
    const first = await report(t.orgId, {
      kind: 'sms',
      usageId,
      units: 3,
      provider: 'twilio',
      source: 'campaign',
      recipient: '+919876543210',
      subjectName: 'Diwali blast',
    });
    expect(first).toMatchObject({ status: 'charged', chargedMinor: 150, balanceAfterMinor: 850 });
    // The same SMS reported again (a retried event, a duplicate status callback) moves no money.
    const again = await report(t.orgId, { kind: 'sms', usageId, units: 3 });
    expect(again).toMatchObject({ status: 'replayed', chargeStatus: 'charged' });
    expect(await balanceMinor(h, t.orgId)).toBe(850);

    const rows = await charges(h, t.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wamid: usageId,
      kind: 'sms',
      units: 3,
      status: 'charged',
      credits: 150,
      price_credits: 150,
      to_country: 'IN',
    });
    const ledger = await ledgerRows(h, t.orgId);
    expect(ledger.at(-1)).toMatchObject({
      type: 'spend',
      direction: 'out',
      minor: -150,
      source: 'usage.sms',
    });
  });

  it('charges an email 0.10 and a WhatsApp call per started minute, and a call nobody answered nothing', async () => {
    const t = await tenant('mix1');
    await fund(h, t.orgId, 1000);
    expect(await report(t.orgId, { kind: 'email', provider: 'gmail' })).toMatchObject({
      status: 'charged',
      chargedMinor: 10,
    });
    // 125 seconds is 3 started minutes at 1.00.
    expect(await report(t.orgId, { kind: 'whatsapp_call', units: 3 })).toMatchObject({
      status: 'charged',
      chargedMinor: 300,
    });
    // An unanswered call has 0 minutes: recorded free, never an error.
    expect(await report(t.orgId, { kind: 'whatsapp_call', units: 0 })).toMatchObject({
      status: 'free',
      reason: 'rate_is_zero',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(1000 - 10 - 300);
    const kinds = (await charges(h, t.orgId)).map((r) => `${r.kind}:${r.status}`);
    expect(kinds).toEqual(['email:charged', 'whatsapp_call:charged', 'whatsapp_call:free']);
  });

  it('takes what is there when the balance is short and records the shortfall; an empty wallet records it unbilled', async () => {
    const t = await tenant('short1');
    await fund(h, t.orgId, 20);
    expect(await report(t.orgId, { kind: 'sms', units: 1 })).toMatchObject({
      status: 'charged',
      chargedMinor: 20,
      shortfallMinor: 30,
    });
    expect(await balanceMinor(h, t.orgId)).toBe(0);
    expect((await events(h, t.orgId, 'wallet.charge.partial')).length).toBe(1);

    expect(await report(t.orgId, { kind: 'sms', units: 1 })).toMatchObject({
      status: 'free',
      reason: 'wallet_empty',
      shortfallMinor: 50,
    });
    expect((await events(h, t.orgId, 'wallet.charge.unbilled')).length).toBe(1);
    const rows = await charges(h, t.orgId);
    expect(rows.map((r) => r.free_reason)).toEqual([null, 'wallet_empty']);
  });

  it('never bills a platform-owned workspace and records nothing for it', async () => {
    const t = await tenant('own1');
    await setPlan(h, t.orgId, { platformOwned: true });
    await fund(h, t.orgId, 1000);
    expect(await report(t.orgId, { kind: 'sms', units: 2 })).toEqual({
      status: 'skipped',
      reason: 'platform_owned',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
    expect(await charges(h, t.orgId)).toHaveLength(0);
  });

  it('ignores a blank usage id and an unknown workspace', async () => {
    expect(await report(0, { kind: 'sms' })).toMatchObject({ status: 'skipped' });
    expect(await report(999_999_999, { kind: 'sms' })).toMatchObject({ status: 'skipped' });
    const t = await tenant('blank1');
    expect(await report(t.orgId, { kind: 'sms', usageId: '   ' })).toEqual({
      status: 'skipped',
      reason: 'invalid_input',
    });
  });

  it('records a switched-off kind and a zero price free, but SMS and email are charged even when switched off', async () => {
    const t = await tenant('off1');
    await fund(h, t.orgId, 500);
    // chat_message defaults to 0: tracked, free.
    expect(await report(t.orgId, { kind: 'chat_message', provider: 'telegram' })).toMatchObject({
      status: 'free',
      reason: 'rate_is_zero',
    });
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('wallet.usage_rates', $1::jsonb, false)`,
      [JSON.stringify({ prices: { email: { enabled: false, priceMinor: 10 } } })],
    );
    services(h).settings.invalidate();
    services(h).usageSettings.invalidate();
    expect(await report(t.orgId, { kind: 'email' })).toMatchObject({
      status: 'charged',
      chargedMinor: 10,
    });
    expect(await balanceMinor(h, t.orgId)).toBe(500);
    expect(await charges(h, t.orgId)).toHaveLength(2);
  });
});

describe('cost-plus usage (AI and translation)', () => {
  it('charges the vendor cost plus 10% and shows it in the expense log as AI', async () => {
    const t = await tenant('ai1');
    await fund(h, t.orgId, 1000);
    const out = await report(t.orgId, {
      kind: 'ai',
      vendorCostUsd: 0.5,
      label: 'AI lead scoring',
      source: 'lead_scoring',
      provider: 'openrouter',
    });
    // 0.50 x 1.10 = 0.55
    expect(out).toMatchObject({ status: 'charged', chargedMinor: 55 });
    const rows = await charges(h, t.orgId);
    expect(rows[0]).toMatchObject({ kind: 'ai', units: 1, status: 'charged', credits: 55 });
    expect((await ledgerRows(h, t.orgId)).at(-1)).toMatchObject({ source: 'usage.ai', minor: -55 });
  });

  it('records a call with no known vendor cost free, and charges the smallest real cost at least 0.01', async () => {
    const t = await tenant('ai2');
    await fund(h, t.orgId, 1000);
    expect(await report(t.orgId, { kind: 'ai', vendorCostUsd: 0 })).toMatchObject({
      status: 'free',
      reason: 'rate_is_zero',
    });
    expect(await report(t.orgId, { kind: 'translation', vendorCostUsd: 0.00002 })).toMatchObject({
      status: 'charged',
      chargedMinor: 1,
    });
  });

  it('takes the AI cost through the AI charge service inside a caller transaction, once per key', async () => {
    const t = await tenant('ai3');
    await fund(h, t.orgId, 1000);
    const { db, ai } = services(h);
    const key = id('lead-run');
    const charge = () =>
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        ai.charge(
          tx,
          { orgId: t.orgId, label: 'AI lead scoring', costUsd: 1, source: 'ai.lead_scoring' },
          key,
        ),
      );
    expect(await charge()).toBe(110);
    expect(await charge()).toBe(0);
    expect(await balanceMinor(h, t.orgId)).toBe(890);
    expect((await charges(h, t.orgId)).map((r) => [r.kind, r.status])).toEqual([['ai', 'charged']]);
  });
});

describe('refunds', () => {
  it('gives the exact charge back once when the provider says it failed, and a late report cannot charge it again', async () => {
    const t = await tenant('ref1');
    await fund(h, t.orgId, 1000);
    const usageId = id('SM');
    await report(t.orgId, { kind: 'sms', usageId, units: 2 });
    expect(await balanceMinor(h, t.orgId)).toBe(900);

    const { usage } = services(h);
    expect(await usage.settleFailed(t.orgId, 'sms', usageId)).toMatchObject({
      refunded: true,
      refundedMinor: 100,
    });
    expect(await usage.settleFailed(t.orgId, 'sms', usageId)).toMatchObject({ refunded: false });
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
    expect((await charges(h, t.orgId))[0]).toMatchObject({ status: 'refunded' });
    expect((await ledgerRows(h, t.orgId)).at(-1)).toMatchObject({
      type: 'refund',
      source: 'usage.sms.refund',
      minor: 100,
    });
    expect(await report(t.orgId, { kind: 'sms', usageId, units: 2 })).toMatchObject({
      status: 'replayed',
      chargeStatus: 'refunded',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
  });

  it('closes a usage reported failed before it was used, so a late `used` cannot charge it', async () => {
    const t = await tenant('ref2');
    await fund(h, t.orgId, 1000);
    const usageId = id('SM');
    await services(h).usage.settleFailed(t.orgId, 'sms', usageId);
    expect(await report(t.orgId, { kind: 'sms', usageId })).toMatchObject({ status: 'replayed' });
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
  });
});

describe('the pre-work gate', () => {
  it('refuses with WALLET_EMPTY when the wallet cannot pay, and lets it through once funded', async () => {
    const t = await tenant('gate1');
    const { usage } = services(h);
    await expect(usage.assertCanAfford(t.orgId, 'sms', 2)).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    await fund(h, t.orgId, 99);
    await expect(usage.assertCanAfford(t.orgId, 'sms', 2)).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    await fund(h, t.orgId, 1);
    await expect(usage.assertCanAfford(t.orgId, 'sms', 2)).resolves.toBeUndefined();
  });

  it('passes a free usage, a platform-owned workspace and an AI call on any positive balance', async () => {
    const t = await tenant('gate2');
    const { usage } = services(h);
    // chat_message is priced 0: nothing to afford.
    await expect(usage.assertCanAfford(t.orgId, 'chat_message')).resolves.toBeUndefined();
    await expect(usage.assertCanAfford(t.orgId, 'ai')).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    await fund(h, t.orgId, 5);
    await expect(usage.assertCanAfford(t.orgId, 'ai')).resolves.toBeUndefined();
    const own = await tenant('gate3');
    await setPlan(h, own.orgId, { platformOwned: true });
    await expect(usage.assertCanAfford(own.orgId, 'sms', 50)).resolves.toBeUndefined();
  });
});

describe('the worker subscriber', () => {
  function consumer() {
    const s = services(h);
    return new UsageBillingConsumer(
      s.usage,
      h.app.get(OutboxSubscriberRegistry, { strict: false }),
      h.app.get(WalletLogService, { strict: false }),
      s.db,
      { balanceChanged: async () => undefined } as unknown as WalletRealtimePublisher,
    );
  }
  const event = (orgId: number, payload: Record<string, unknown>) => ({
    id: String(n++),
    orgId,
    aggregateModule: 'sms',
    aggregateId: '1',
    eventType: USAGE_REPORTED_EVENT,
    payload,
  });

  it('charges a reported usage and refunds a failed one, through the event the features write', async () => {
    const t = await tenant('con1');
    await fund(h, t.orgId, 1000);
    const usageId = id('SM');
    const c = consumer();
    await c.handle(event(t.orgId, { kind: 'sms', usageId, units: 2, status: 'used' }));
    expect(await balanceMinor(h, t.orgId)).toBe(900);
    await c.handle(event(t.orgId, { kind: 'sms', usageId, units: 2, status: 'failed' }));
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
  });

  it('drops a malformed event instead of retrying it forever', async () => {
    const t = await tenant('con2');
    await expect(
      consumer().handle(event(t.orgId, { kind: 'telegram', usageId: '' })),
    ).resolves.toBeUndefined();
  });

  it('emits the event in the caller transaction and refuses a report that does not parse', async () => {
    const t = await tenant('con3');
    const { db } = services(h);
    const outbox = h.app.get(OutboxService, { strict: false });
    const ok = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      emitUsageReported(outbox, tx, {
        orgId: t.orgId,
        aggregateModule: 'sms',
        aggregateId: 7,
        report: { kind: 'sms', usageId: id('SM'), units: 2 },
      }),
    );
    expect(ok).toBe(true);
    const bad = await db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
      emitUsageReported(outbox, tx, {
        orgId: t.orgId,
        aggregateModule: 'sms',
        aggregateId: 7,
        report: { kind: 'sms', usageId: '' },
      }),
    );
    expect(bad).toBe(false);
    expect(await h.api.events(t.orgId, USAGE_REPORTED_EVENT)).toHaveLength(1);
  });
});

describe('the operator prices and the customer expense log', () => {
  it('lets a super admin read and save prices, and the next charge uses them', async () => {
    const t = await tenant('price1');
    await fund(h, t.orgId, 1000);
    const auth = { authorization: `Bearer ${h.superToken}` };
    const read = await h.api.http().get('/v2/platform/wallet/usage-rates').set(auth);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const view = walletUsageSettingsSchema.parse(read.body);
    expect(view.prices.find((p) => p.kind === 'sms')).toMatchObject({
      enabled: true,
      priceMinor: 50,
      unit: 'segment',
    });
    expect(view.markupBps).toBe(1000);

    const save = await h.api
      .http()
      .put('/v2/platform/wallet/usage-rates')
      .set(auth)
      .send({ prices: [{ kind: 'sms', price: '1.25' }], markupBps: 2500 });
    expect(save.status, JSON.stringify(save.body)).toBe(200);
    expect(
      walletUsageSettingsSchema.parse(save.body).prices.find((p) => p.kind === 'sms'),
    ).toMatchObject({
      priceMinor: 125,
    });
    expect(await report(t.orgId, { kind: 'sms', units: 2 })).toMatchObject({ chargedMinor: 250 });
    // 25% markup on 1.00 of AI.
    expect(await report(t.orgId, { kind: 'ai', vendorCostUsd: 1 })).toMatchObject({
      chargedMinor: 125,
    });
    const bad = await h.api
      .http()
      .put('/v2/platform/wallet/usage-rates')
      .set(auth)
      .send({ prices: [{ kind: 'sms', price: 'abc' }] });
    expect(bad.status).toBe(422);
  });

  it('shows every kind in the customer expense log, filters by kind and sums by kind', async () => {
    const t = await tenant('log1');
    await fund(h, t.orgId, 5000);
    await report(t.orgId, {
      kind: 'sms',
      units: 2,
      subjectName: 'Spring promo',
      source: 'campaign',
    });
    await report(t.orgId, { kind: 'email', source: 'inbox' });
    await report(t.orgId, {
      kind: 'ai',
      vendorCostUsd: 1,
      label: 'AI lead scoring',
      source: 'lead_scoring',
    });
    await report(t.orgId, { kind: 'whatsapp_call', units: 2, source: 'inbox' });

    const get = (path: string) => h.api.http().get(`/v2/wallet${path}`).set(bearer(t.admin));
    const list = await get('/expenses?limit=50');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const body = expenseListResponseSchema.parse(list.body);
    expect(body.data.map((r) => r.kind).sort()).toEqual(['ai', 'email', 'sms', 'whatsapp_call']);
    const sms = body.data.find((r) => r.kind === 'sms')!;
    expect(sms).toMatchObject({
      units: 2,
      chargedMinor: 100,
      netMinor: 100,
      subjectName: 'Spring promo',
    });
    expect(body.data.find((r) => r.kind === 'ai')).toMatchObject({
      subjectName: 'AI lead scoring',
      chargedMinor: 110,
    });

    const onlyAi = expenseListResponseSchema.parse((await get('/expenses?kind=ai')).body);
    expect(onlyAi.data.map((r) => r.kind)).toEqual(['ai']);

    const sum = expenseSummaryResponseSchema.parse(
      (await get('/expenses/summary?groupBy=kind')).body,
    );
    const byKind = new Map(sum.groups.map((g) => [g.key, g]));
    expect(byKind.get('sms')).toMatchObject({ messages: 1, chargedMinor: 100 });
    expect(byKind.get('whatsapp_call')).toMatchObject({ chargedMinor: 200 });
    expect(sum.totals.chargedMinor).toBe(100 + 10 + 110 + 200);
  });
});
