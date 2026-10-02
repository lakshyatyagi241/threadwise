import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES, MESSAGE_DELIVERY_EVENT } from '@crm/contracts';
import { DeliveryBillingConsumer } from '../../../src/modules/wallet-message-billing/delivery.consumer';
import { RateCardService } from '../../../src/modules/wallet-message-billing/rate-card.service';
import { WalletRealtimePublisher } from '../../../src/modules/wallet-message-billing/wallet-realtime.publisher';
import { WalletLogService } from '../../../src/modules/wallet-message-billing/wallet-log.service';
import { OutboxSubscriberRegistry } from '../../../src/kernel/outbox/outbox-subscribers';
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
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * The money engine end to end on the real schema: the ledger funnel, delivery-time settlement and refunds, the monthly quota,
 * the low-balance alert and the launch gate (WD-WALLET-001, -008 to -013, -015). One app, one database, a workspace per block.
 * Prices come from the seeded starter card: US marketing 12.00, India marketing 1.00, service 0, anything else 1.00.
 */
let h: BspHarness;
let startedAt: Date;
let n = 0;
const wamid = () => `wamid.${Date.now()}.${n++}`;
const US = '+14155550100';
const IN = '+919876543210';

async function tenant(
  label: string,
  opts: { reseller?: boolean } = { reseller: true },
): Promise<Tenant> {
  const t = await newTenant(h, label);
  if (opts.reseller) await setReseller(h, t.orgId, true);
  return t;
}

const settle = (
  orgId: number,
  over: Partial<{
    id: string;
    to: string;
    category: string | null;
    provider: 'waba' | 'twilio' | 'baileys';
    source: string;
  }> = {},
) =>
  services(h).billing.settleDelivered({
    orgId,
    provider: over.provider ?? 'waba',
    providerMessageId: over.id ?? wamid(),
    recipient: over.to ?? US,
    category: over.category === undefined ? 'marketing' : over.category,
    source: over.source ?? 'campaign',
  });

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  // Per-country pricing on, as an operator would switch it on.
  const r = await h.api
    .http()
    .put('/v2/platform/wallet/switches')
    .set({ authorization: `Bearer ${h.superToken}` })
    .send({ perCountryEnabled: true });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('the ledger funnel (WD-WALLET-001)', () => {
  it('posts a top-up as one signed entry whose balance_after equals the wallet', async () => {
    const t = await tenant('led1');
    const r = await fund(h, t.orgId, 5000);
    expect(r).toMatchObject({
      appliedMinor: 5000,
      balanceBeforeMinor: 0,
      balanceAfterMinor: 5000,
      replayed: false,
    });
    expect(await balanceMinor(h, t.orgId)).toBe(5000);
    const rows = await ledgerRows(h, t.orgId);
    expect(rows).toEqual([
      expect.objectContaining({ type: 'topup', direction: 'in', minor: 5000, after: 5000 }),
    ]);
  });

  it('posts once per idempotency key: a gateway retry returns the first result and moves no money', async () => {
    const t = await tenant('led2');
    await fund(h, t.orgId, 1000, 'order:abc');
    const again = await fund(h, t.orgId, 1000, 'order:abc');
    expect(again.replayed).toBe(true);
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
    expect(await ledgerRows(h, t.orgId)).toHaveLength(1);
  });

  it('two debits of 8.00 racing on 10.00 take 10.00 in total, never overspend, and the ledger sums to the balance', async () => {
    const t = await tenant('led3');
    await fund(h, t.orgId, 1000);
    const { db, ledger } = services(h);
    const debit = (key: string) =>
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        ledger.post(tx, {
          orgId: t.orgId,
          unit: 'USD',
          type: 'spend',
          direction: 'out',
          amountMinor: 800,
          idempotencyKey: key,
          allowPartial: true,
        }),
      );
    const results = await Promise.all([debit('r1'), debit('r2')]);
    expect(results.map((r) => r.appliedMinor).sort((a, b) => a - b)).toEqual([200, 800]);
    expect(await balanceMinor(h, t.orgId)).toBe(0);
    const rows = await ledgerRows(h, t.orgId);
    expect(rows.reduce((s, r) => s + r.minor, 0)).toBe(0);
    expect(rows.every((r) => r.after >= 0)).toBe(true);
  });

  it('refuses a strict debit above the balance with a stable code and leaves nothing behind', async () => {
    const t = await tenant('led4');
    await fund(h, t.orgId, 300);
    const { db, ledger } = services(h);
    await expect(
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        ledger.post(tx, {
          orgId: t.orgId,
          unit: 'USD',
          type: 'spend',
          direction: 'out',
          amountMinor: 500,
          idempotencyKey: 'strict',
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.WALLET_INSUFFICIENT_BALANCE });
    expect(await balanceMinor(h, t.orgId)).toBe(300);
    expect(await ledgerRows(h, t.orgId)).toHaveLength(1);
  });

  it('rejects a manual adjustment without a note before touching the wallet', async () => {
    const t = await tenant('led5');
    const { db, ledger } = services(h);
    await expect(
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        ledger.post(tx, {
          orgId: t.orgId,
          unit: 'USD',
          type: 'admin_adjust',
          direction: 'in',
          amountMinor: 100,
          idempotencyKey: 'nonote',
          note: '  ',
        }),
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.WALLET_NOTE_REQUIRED });
    expect(await ledgerRows(h, t.orgId)).toHaveLength(0);
  });
});

describe('settleDelivered (WD-WALLET-009)', () => {
  it('charges a US marketing message 12.00 once: wallet 100.00 -> 88.00, one spend entry, one charge row', async () => {
    const t = await tenant('s1');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    const out = await settle(t.orgId, { id });
    expect(out).toMatchObject({
      status: 'charged',
      chargedMinor: 1200,
      shortfallMinor: 0,
      balanceAfterMinor: 8800,
    });
    const rows = await ledgerRows(h, t.orgId);
    expect(rows.at(-1)).toMatchObject({
      type: 'spend',
      direction: 'out',
      minor: -1200,
      after: 8800,
      source: 'message.sent',
    });
    expect(await charges(h, t.orgId)).toEqual([
      expect.objectContaining({
        wamid: id,
        status: 'charged',
        credits: 1200,
        price_credits: 1200,
        shortfall_credits: 0,
        billing_mode: 'wallet',
        to_country: 'US',
        category: 'marketing',
      }),
    ]);
  });

  it('charges nothing more when the same message id is reported again as read, or twice at once', async () => {
    const t = await tenant('s2');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    await settle(t.orgId, { id });
    const [a, b, c] = await Promise.all([
      settle(t.orgId, { id }),
      settle(t.orgId, { id }),
      settle(t.orgId, { id }),
    ]);
    for (const r of [a, b, c]) expect(r).toMatchObject({ status: 'replayed' });
    expect(await balanceMinor(h, t.orgId)).toBe(8800);
    expect(await charges(h, t.orgId)).toHaveLength(1);
  });

  it('charges what is there when the balance is short, records the shortfall and logs it', async () => {
    const t = await tenant('s3');
    await fund(h, t.orgId, 300);
    const out = await settle(t.orgId);
    expect(out).toMatchObject({
      status: 'charged',
      chargedMinor: 300,
      shortfallMinor: 900,
      balanceAfterMinor: 0,
    });
    expect((await charges(h, t.orgId))[0]).toMatchObject({
      credits: 300,
      price_credits: 1200,
      shortfall_credits: 900,
    });
    expect(await events(h, t.orgId, 'wallet.charge.partial')).toHaveLength(1);
  });

  it('records a message free when the wallet is empty, logs it as unbilled and raises the low-balance alert', async () => {
    const t = await tenant('s4');
    const out = await settle(t.orgId);
    expect(out).toMatchObject({ status: 'free', reason: 'wallet_empty', shortfallMinor: 1200 });
    expect((await charges(h, t.orgId))[0]).toMatchObject({
      status: 'free',
      free_reason: 'wallet_empty',
      credits: 0,
      shortfall_credits: 1200,
    });
    expect(await events(h, t.orgId, 'wallet.charge.unbilled')).toHaveLength(1);
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(1);
  });

  it('records a service message free with its Meta cost known and no ledger entry', async () => {
    const t = await tenant('s5');
    await fund(h, t.orgId, 1000);
    await h.owner.query(
      `UPDATE message_rates SET meta_cost_micros = 4000, meta_cost_minor = 0 WHERE country_code = '' AND category = 'service'`,
    );
    // The resolver holds the card for 30 s per process; a write through this module drops it, a hand edit does not.
    const rates = h.app.get(RateCardService, { strict: false });
    rates.invalidate();
    try {
      const out = await settle(t.orgId, { category: 'service' });
      expect(out).toMatchObject({ status: 'free', reason: 'rate_is_zero' });
      const c = (await charges(h, t.orgId))[0];
      expect(c).toMatchObject({ status: 'free', credits: 0, free_reason: 'rate_is_zero' });
      expect(Number(c.cost_micros)).toBe(4000);
      expect((await ledgerRows(h, t.orgId)).filter((r) => r.type === 'spend')).toHaveLength(0);
    } finally {
      await h.owner.query(
        `UPDATE message_rates SET meta_cost_micros = NULL, meta_cost_minor = NULL WHERE country_code = '' AND category = 'service'`,
      );
      rates.invalidate();
    }
  });

  it('never bills a platform-owned workspace and records nothing for it', async () => {
    const t = await tenant('s6');
    await setPlan(h, t.orgId, { platformOwned: true });
    await fund(h, t.orgId, 1000);
    expect(await settle(t.orgId)).toEqual({ status: 'skipped', reason: 'platform_owned' });
    expect(await charges(h, t.orgId)).toHaveLength(0);
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
  });

  it('ignores a blank message id and an unknown workspace', async () => {
    expect(await settle(0)).toMatchObject({ status: 'skipped' });
    const t = await tenant('s7');
    expect(await settle(t.orgId, { id: '   ' })).toMatchObject({
      status: 'skipped',
      reason: 'invalid_input',
    });
    expect(await settle(999_999_999)).toMatchObject({
      status: 'skipped',
      reason: 'unknown_workspace',
    });
  });

  it('prices by the recipient country: India marketing 1.00, an unknown prefix at the default', async () => {
    const t = await tenant('s8');
    await fund(h, t.orgId, 10_000);
    expect(await settle(t.orgId, { to: IN })).toMatchObject({ chargedMinor: 100 });
    expect(await settle(t.orgId, { to: '+999123456789', category: 'utility' })).toMatchObject({
      chargedMinor: 100,
    });
  });

  it('settles 20 different messages racing on 100.00 without overspending: every id once, wallet never negative', async () => {
    const t = await tenant('s9');
    await fund(h, t.orgId, 10_000);
    const ids = Array.from({ length: 20 }, () => wamid());
    await Promise.all(ids.map((id) => settle(t.orgId, { id })));
    const rows = await charges(h, t.orgId);
    expect(rows).toHaveLength(20);
    expect(new Set(rows.map((r) => r.wamid)).size).toBe(20);
    const taken = rows.reduce((s, r) => s + Number(r.credits), 0);
    expect(taken).toBe(10_000);
    expect(await balanceMinor(h, t.orgId)).toBe(0);
    expect((await ledgerRows(h, t.orgId)).every((r) => r.after >= 0)).toBe(true);
  });
});

describe('plan allowance (WD-WALLET-010)', () => {
  it('lets the first N messages of the month through free, then charges the wallet', async () => {
    const t = await tenant('q1', { reseller: false });
    await setPlan(h, t.orgId, { monthly: 2 });
    await fund(h, t.orgId, 5000);
    expect(await settle(t.orgId)).toMatchObject({
      status: 'free',
      reason: 'within_plan_free_quota',
    });
    expect(await settle(t.orgId)).toMatchObject({
      status: 'free',
      reason: 'within_plan_free_quota',
    });
    expect(await settle(t.orgId)).toMatchObject({ status: 'charged', chargedMinor: 1200 });
    expect((await charges(h, t.orgId)).map((c) => c.billing_mode)).toEqual([
      'plan',
      'plan',
      'plan',
    ]);
    const month = await h.owner.query(
      `SELECT messages FROM wallet_usage_months WHERE org_id = $1`,
      [t.orgId],
    );
    expect(month.rows[0].messages).toBe(3);
  });

  it('gives an ended plan no allowance: the wallet pays from the first message', async () => {
    const t = await tenant('q2', { reseller: false });
    await setPlan(h, t.orgId, { monthly: 1000, planEndsAt: '2020-01-01T00:00:00Z' });
    await fund(h, t.orgId, 5000);
    expect(await settle(t.orgId)).toMatchObject({ status: 'charged', chargedMinor: 1200 });
  });

  it('never touches the wallet of an unlimited plan', async () => {
    const t = await tenant('q3', { reseller: false });
    await setPlan(h, t.orgId, {});
    await fund(h, t.orgId, 5000);
    for (let i = 0; i < 3; i++) await settle(t.orgId);
    expect(await balanceMinor(h, t.orgId)).toBe(5000);
  });

  it('ignores the allowance for a pay-per-message workspace', async () => {
    const t = await tenant('q4');
    await setPlan(h, t.orgId, { monthly: 1000 });
    await fund(h, t.orgId, 5000);
    expect(await settle(t.orgId)).toMatchObject({ status: 'charged' });
  });

  it('counts concurrent deliveries at the boundary exactly: of 5 racing for 3 free places, 3 are free', async () => {
    const t = await tenant('q5', { reseller: false });
    await setPlan(h, t.orgId, { monthly: 3 });
    await fund(h, t.orgId, 50_000);
    await Promise.all(Array.from({ length: 5 }, () => settle(t.orgId)));
    const rows = await charges(h, t.orgId);
    expect(rows.filter((r) => r.status === 'free')).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'charged')).toHaveLength(2);
  });
});

describe('settleFailed (WD-WALLET-011)', () => {
  it('gives back the exact charge once, as a compensating entry that leaves the original alone', async () => {
    const t = await tenant('f1');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    await settle(t.orgId, { id });
    const { billing } = services(h);
    const [a, b] = await Promise.all([
      billing.settleFailed(t.orgId, id),
      billing.settleFailed(t.orgId, id),
    ]);
    expect([a.refunded, b.refunded].sort()).toEqual([false, true]);
    expect(await balanceMinor(h, t.orgId)).toBe(10_000);
    const rows = await ledgerRows(h, t.orgId);
    expect(rows.map((r) => `${r.type}:${r.minor}`)).toEqual([
      'topup:10000',
      'spend:-1200',
      'refund:1200',
    ]);
    expect((await charges(h, t.orgId))[0]).toMatchObject({ status: 'refunded' });
    expect(await events(h, t.orgId, 'wallet.charge.refunded')).toHaveLength(1);
  });

  it('refunds a partial charge partially, at the money actually taken', async () => {
    const t = await tenant('f2');
    await fund(h, t.orgId, 300);
    const id = wamid();
    await settle(t.orgId, { id });
    await services(h).billing.settleFailed(t.orgId, id);
    expect(await balanceMinor(h, t.orgId)).toBe(300);
  });

  it('moves no money for a free message, an unknown id or a message never charged', async () => {
    const t = await tenant('f3');
    await fund(h, t.orgId, 1000);
    const id = wamid();
    await settle(t.orgId, { id, category: 'service' });
    const { billing } = services(h);
    expect(await billing.settleFailed(t.orgId, id)).toMatchObject({
      refunded: false,
      refundedMinor: 0,
    });
    expect(await billing.settleFailed(t.orgId, 'never-sent')).toEqual({
      refunded: false,
      refundedMinor: 0,
    });
    expect(await balanceMinor(h, t.orgId)).toBe(1000);
  });

  it('a later delivery report of a refunded message does not charge it again', async () => {
    const t = await tenant('f4');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    await settle(t.orgId, { id });
    await services(h).billing.settleFailed(t.orgId, id);
    expect(await settle(t.orgId, { id })).toMatchObject({
      status: 'replayed',
      chargeStatus: 'refunded',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(10_000);
  });
});

describe('low-balance alert (WD-WALLET-015)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'wallet.economics'`);
    services(h).settings.invalidate();
  });

  it('fires once at or under the threshold, not again within six hours, and again after a top-up re-arms it', async () => {
    const t = await tenant('l1');
    // threshold 0.20 by default: leave 0.05 after the charge
    await fund(h, t.orgId, 1205);
    await settle(t.orgId);
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(1);
    await fund(h, t.orgId, 1000); // a top-up clears the throttle
    await settle(t.orgId, { to: IN }); // 10.05 -> 9.05? above the threshold: no alert
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(1);
    await settle(t.orgId); // 12.00 > 9.05: partial charge empties the wallet, low again after the re-arm
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(2);
    await settle(t.orgId); // wallet empty again within the window: still two
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(2);
  });

  it('stays quiet while the balance is above the threshold', async () => {
    const t = await tenant('l2');
    await fund(h, t.orgId, 50_000);
    await settle(t.orgId);
    expect(await h.api.events(t.orgId, 'wallet.low_balance')).toHaveLength(0);
  });
});

describe('the delivery subscriber (WD-WALLET-012)', () => {
  function consumer() {
    const s = services(h);
    return new DeliveryBillingConsumer(
      s.billing,
      h.app.get(OutboxSubscriberRegistry, { strict: false }),
      h.app.get(WalletLogService, { strict: false }),
      s.db,
      { balanceChanged: async () => undefined } as unknown as WalletRealtimePublisher,
    );
  }
  const event = (orgId: number, payload: Record<string, unknown>) => ({
    id: String(n++),
    orgId,
    aggregateModule: 'messages',
    aggregateId: '1',
    eventType: MESSAGE_DELIVERY_EVENT,
    payload,
  });

  it('charges on delivered, ignores sent for the Cloud API, refunds on failed', async () => {
    const t = await tenant('d1');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    const c = consumer();
    const base = {
      provider: 'waba',
      providerMessageId: id,
      recipient: US,
      category: 'marketing',
      source: 'campaign',
    };
    await c.handle(event(t.orgId, { ...base, status: 'sent' }));
    expect(await charges(h, t.orgId)).toHaveLength(0);
    await c.handle(event(t.orgId, { ...base, status: 'delivered' }));
    await c.handle(event(t.orgId, { ...base, status: 'read' }));
    expect(await balanceMinor(h, t.orgId)).toBe(8800);
    await c.handle(event(t.orgId, { ...base, status: 'failed' }));
    expect(await balanceMinor(h, t.orgId)).toBe(10_000);
  });

  it('charges a Baileys message already on sent, once, even when delivered follows', async () => {
    const t = await tenant('d2');
    await fund(h, t.orgId, 10_000);
    const id = wamid();
    const c = consumer();
    const base = {
      provider: 'baileys',
      providerMessageId: id,
      recipient: IN,
      category: null,
      source: 'broadcast',
    };
    await c.handle(event(t.orgId, { ...base, status: 'sent' }));
    await c.handle(event(t.orgId, { ...base, status: 'delivered' }));
    expect(await charges(h, t.orgId)).toHaveLength(1);
  });

  it('drops a malformed event instead of retrying it forever', async () => {
    const t = await tenant('d3');
    await expect(
      consumer().handle(event(t.orgId, { provider: 'carrier-pigeon', status: 'delivered' })),
    ).resolves.toBeUndefined();
  });
});

describe('the launch gate (WD-WALLET-013)', () => {
  it('refuses a pay-per-message launch on an empty wallet with the WaDesk message and logs the refusal', async () => {
    const t = await tenant('g1');
    await expect(
      services(h).gate.assertCanLaunch({ orgId: t.orgId, source: 'broadcast', recipients: 100 }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
      message: 'Your message wallet is empty. Top up to start sending.',
    });
    expect(await events(h, t.orgId, 'wallet.launch.blocked')).toHaveLength(1);
  });

  it('refuses a wallet that cannot cover the estimate, and lets the same launch through once it is funded', async () => {
    const t = await tenant('g2');
    await fund(h, t.orgId, 100);
    const req = { orgId: t.orgId, source: 'campaign', recipients: 5000 };
    await expect(services(h).gate.assertCanLaunch(req)).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    await fund(h, t.orgId, 6_000_000);
    await expect(services(h).gate.assertCanLaunch(req)).resolves.toBeUndefined();
  });

  it('prices the estimate by each recipient country when the numbers are given', async () => {
    const t = await tenant('g3');
    await fund(h, t.orgId, 5000);
    // 10 US marketing numbers cost 120.00; 10 Indian ones 10.00
    await expect(
      services(h).gate.assertCanLaunch({
        orgId: t.orgId,
        source: 'campaign',
        recipients: 10,
        phones: Array(10).fill(US),
      }),
    ).rejects.toBeTruthy();
    await expect(
      services(h).gate.assertCanLaunch({
        orgId: t.orgId,
        source: 'campaign',
        recipients: 10,
        phones: Array(10).fill(IN),
      }),
    ).resolves.toBeUndefined();
  });

  it('lets a classic workspace inside its free allowance launch with an empty wallet, but not past it', async () => {
    const t = await tenant('g4', { reseller: false });
    await setPlan(h, t.orgId, { monthly: 1000 });
    await expect(
      services(h).gate.assertCanLaunch({ orgId: t.orgId, source: 'broadcast', recipients: 100 }),
    ).resolves.toBeUndefined();
    await expect(
      services(h).gate.assertCanLaunch({ orgId: t.orgId, source: 'broadcast', recipients: 5000 }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
  });

  it('never blocks a platform-owned workspace', async () => {
    const t = await tenant('g5');
    await setPlan(h, t.orgId, { platformOwned: true });
    await expect(
      services(h).gate.assertCanLaunch({
        orgId: t.orgId,
        source: 'broadcast',
        recipients: 1_000_000,
      }),
    ).resolves.toBeUndefined();
  });

  it('lets a send through when the lookup itself fails (fail open, as WaDesk)', async () => {
    await expect(
      services(h).gate.assertCanLaunch({ orgId: 999_999_999, source: 'broadcast', recipients: 10 }),
    ).resolves.toBeUndefined();
  });
});

describe('billing mode (WD-WALLET-008)', () => {
  it('a reseller workspace is wallet-billed with the global switch off; a direct one only while it is on', async () => {
    const reseller = await tenant('m1');
    const direct = await tenant('m2', { reseller: false });
    await setPlan(h, direct.orgId, { monthly: 1000 });
    await fund(h, direct.orgId, 5000);
    expect(await settle(reseller.orgId)).toMatchObject({ status: 'free', reason: 'wallet_empty' });
    expect(await settle(direct.orgId)).toMatchObject({
      status: 'free',
      reason: 'within_plan_free_quota',
    });
    const on = await h.api
      .http()
      .put('/v2/platform/wallet/switches')
      .set({ authorization: `Bearer ${h.superToken}` })
      .send({ payPerMessage: true });
    expect(on.status).toBe(200);
    try {
      expect(await settle(direct.orgId)).toMatchObject({ status: 'charged' });
    } finally {
      await h.api
        .http()
        .put('/v2/platform/wallet/switches')
        .set({ authorization: `Bearer ${h.superToken}` })
        .send({ payPerMessage: false });
    }
  });
});
