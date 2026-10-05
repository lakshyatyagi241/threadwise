import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  bspDashboardSchema,
  platformWalletDetailSchema,
  platformWalletListSchema,
  platformWalletOverviewSchema,
  priceFromMargin,
  reconciliationSchema,
  walletSummarySchema,
} from '@crm/contracts';
import { convertMinor } from '../../../src/modules/wallet-message-billing/wallet-rules';
import {
  cleanWallet,
  newTenant,
  services,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * A workspace is billed in its own currency: its messages are priced from Meta's card for that currency, charged to the wallet in
 * that currency, refunded to it, and shown (statement, balance, price panel, export, operator list, P&L) in it. Two workspaces on
 * the same platform, one in USD and one in INR, side by side. Meta's official 1 October 2026 cards are in the database from the seed.
 */
let h: BspHarness;
let startedAt: Date;
let usd: Tenant;
let inr: Tenant;
let inrUuid = '';
let n = 0;
const IN = '+919876543210';
const US = '+14155550100';
const wamid = () => `cur-${Date.now()}-${n++}`;

const ops = (m: 'get' | 'post' | 'put' | 'delete', path: string, token = h.superToken) =>
  h.api
    .http()
    [m](`/v2/platform/wallet${path}`)
    .set({ authorization: `Bearer ${token}` });
const me = (token: string) => h.api.as(token);

const setCurrency = (orgId: number, code: string | null) =>
  h.owner.query(
    code === null
      ? `UPDATE organizations SET settings = settings - 'currency' WHERE id = $1`
      : `UPDATE organizations SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{currency}', to_jsonb($2::text)) WHERE id = $1`,
    code === null ? [orgId] : [orgId, code],
  );

/** Puts money straight into one currency's wallet through the ledger, like a paid top-up. */
async function fundIn(orgId: number, unit: string, minor: number) {
  const { db, ledger } = services(h);
  return db.txAs({ orgId, userId: null }, (tx) =>
    ledger.post(tx, {
      orgId,
      unit,
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: `fund:${orgId}:${unit}:${Math.random()}`,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    }),
  );
}

const settle = (orgId: number, to = IN, category = 'marketing') =>
  services(h).billing.settleDelivered({
    orgId,
    provider: 'waba',
    providerMessageId: wamid(),
    recipient: to,
    category,
    source: 'campaign',
  });

const wallets = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT unit, (balance * 100)::bigint AS minor FROM wallets WHERE org_id = $1 ORDER BY unit`,
      [orgId],
    )
  ).rows.map((r) => ({ unit: r.unit as string, minor: Number(r.minor) }));

const lastCharge = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT currency, credits, price_credits, cost_micros::text AS micros, status, to_country
       FROM usage_charges WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [orgId],
    )
  ).rows[0];

const rate = async (code: string) =>
  Number(
    (await h.owner.query(`SELECT exchange_rate::text AS r FROM currencies WHERE code = $1`, [code]))
      .rows[0].r,
  );

const cardMicros = async (cur: string, market: string, cat: string) =>
  Number(
    (
      await h.owner.query(
        `SELECT cost_micros::text AS m FROM meta_rate_cards WHERE currency = $1 AND market = $2 AND category = $3`,
        [cur, market, cat],
      )
    ).rows[0].m,
  );

const platformMarginBps = async () =>
  Number(
    (
      await h.owner.query(
        `SELECT margin_bps FROM plan_message_margins WHERE plan_slug = '' AND country_code = '' AND category = ''`,
      )
    ).rows[0].margin_bps,
  );

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  usd = await newTenant(h, 'cur-usd');
  inr = await newTenant(h, 'cur-inr');
  inrUuid = (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [inr.orgId]))
    .rows[0].uuid;
  await setReseller(h, usd.orgId, true);
  await setReseller(h, inr.orgId, true);
  await setCurrency(inr.orgId, 'INR');
  // The platform currency is USD. Per-country pricing and margin pricing are what an INR operator would run.
  await h.owner.query(
    `INSERT INTO plan_message_margins (plan_slug, country_code, category, margin_bps) VALUES ('', '', '', 2000) ON CONFLICT DO NOTHING`,
  );
  const sw = await ops('put', '/switches').send({ perCountryEnabled: true, pricingMode: 'margin' });
  expect(sw.status, JSON.stringify(sw.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await ops('put', '/switches').send({ pricingMode: 'fixed' });
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('which wallet and which price', () => {
  it('bills a workspace in its own currency, and one with no currency set in the platform currency', async () => {
    const { db, ...s } = services(h);
    void s;
    const billing = h.app.get(
      (await import('../../../src/modules/wallet-message-billing/billing-currency.service'))
        .BillingCurrencyService,
      { strict: false },
    );
    const unit = (orgId: number) =>
      db.txAs({ orgId, userId: null }, (tx) => billing.forOrg(tx, orgId));
    expect(await unit(inr.orgId)).toBe('INR');
    expect(await unit(usd.orgId)).toBe('USD');
  });

  it('keeps a workspace in the platform currency while Meta’s card for its currency has not been imported', async () => {
    const billing = h.app.get(
      (await import('../../../src/modules/wallet-message-billing/billing-currency.service'))
        .BillingCurrencyService,
      { strict: false },
    );
    const { db } = services(h);
    await setCurrency(usd.orgId, 'EUR'); // no EUR card
    expect(
      await db.txAs({ orgId: usd.orgId, userId: null }, (tx) => billing.forOrg(tx, usd.orgId)),
    ).toBe('USD');
    await setCurrency(usd.orgId, null);
  });
});

describe('charging a message', () => {
  it('prices an INR workspace from Meta’s INR card and takes the money from its INR wallet', async () => {
    await fundIn(inr.orgId, 'INR', 10_000); // ₹100.00
    const out = await settle(inr.orgId, IN);
    const cost = await cardMicros('INR', 'India', 'marketing');
    expect(cost).toBe(863_100);
    const expected = priceFromMargin(cost, await platformMarginBps());
    expect(out).toMatchObject({ status: 'charged', chargedMinor: expected });
    expect(await lastCharge(inr.orgId)).toMatchObject({
      currency: 'INR',
      credits: expected,
      micros: '863100',
      to_country: 'IN',
    });
    expect(await wallets(inr.orgId)).toEqual([{ unit: 'INR', minor: 10_000 - expected }]);
    const ledger = await h.owner.query(
      `SELECT unit, type FROM wallet_transactions WHERE org_id = $1 ORDER BY id`,
      [inr.orgId],
    );
    expect(ledger.rows.map((r) => r.unit)).toEqual(['INR', 'INR']);
  });

  it('prices the same message for a USD workspace from Meta’s USD card, in dollars', async () => {
    await fundIn(usd.orgId, 'USD', 1000);
    const out = await settle(usd.orgId, IN);
    const cost = await cardMicros('USD', 'India', 'marketing');
    expect(cost).toBe(11_800);
    const expected = priceFromMargin(cost, await platformMarginBps());
    expect(out).toMatchObject({ status: 'charged', chargedMinor: expected });
    expect(await lastCharge(usd.orgId)).toMatchObject({ currency: 'USD', micros: '11800' });
    expect(await wallets(usd.orgId)).toEqual([{ unit: 'USD', minor: 1000 - expected }]);
  });

  it('uses the card for a country Meta groups into a region (Thailand, "Rest of Asia Pacific")', async () => {
    await settle(inr.orgId, '+66812345678', 'utility');
    const region = await cardMicros('INR', 'Rest of Asia Pacific', 'utility');
    expect((await lastCharge(inr.orgId)).micros).toBe(String(region));
  });

  it('falls back to Meta’s "Other" market for a country no list names', async () => {
    await settle(inr.orgId, '+423 660 1234', 'utility'); // Liechtenstein is not on Meta's card
    expect((await lastCharge(inr.orgId)).micros).toBe(
      String(await cardMicros('INR', 'Other', 'utility')),
    );
  });

  it('refunds a failed message to the wallet it was charged to, in its currency', async () => {
    await fundIn(inr.orgId, 'INR', 1000);
    const id = wamid();
    const before = (await wallets(inr.orgId))[0]!.minor;
    const s = await services(h).billing.settleDelivered({
      orgId: inr.orgId,
      provider: 'waba',
      providerMessageId: id,
      recipient: IN,
      category: 'marketing',
      source: 'campaign',
    });
    expect(s.status).toBe('charged');
    const refund = await services(h).billing.settleFailed(inr.orgId, id);
    expect(refund.refunded).toBe(true);
    expect((await wallets(inr.orgId))[0]!.minor).toBe(before);
    const last = await h.owner.query(
      `SELECT unit, type FROM wallet_transactions WHERE org_id = $1 ORDER BY id DESC LIMIT 1`,
      [inr.orgId],
    );
    expect(last.rows[0]).toMatchObject({ unit: 'INR', type: 'refund' });
  });

  it('converts a typed price at the rate on file for an INR workspace when margin pricing is off', async () => {
    await ops('put', '/switches').send({ pricingMode: 'fixed' });
    try {
      await fundIn(inr.orgId, 'INR', 200_000); // enough for a converted dollar price
      const out = await settle(inr.orgId, US); // the starter card types US marketing at 12.00
      const typed = Number(
        (
          await h.owner.query(
            `SELECT credits FROM message_rates WHERE country_code = 'US' AND category = 'marketing'`,
          )
        ).rows[0].credits,
      );
      const expected = convertMinor(typed, await rate('USD'), await rate('INR'));
      expect(out).toMatchObject({ status: 'charged', chargedMinor: expected });
      expect((await lastCharge(inr.orgId)).currency).toBe('INR');
    } finally {
      await ops('put', '/switches').send({ pricingMode: 'margin' });
    }
  });
});

describe('what the workspace sees', () => {
  it('shows the balance, the ledger and the statement in the wallet it bills from', async () => {
    // Money left in a USD wallet (the workspace used to bill in dollars) is not mixed into the INR screens.
    await fundIn(inr.orgId, 'USD', 5000);
    const summary = walletSummarySchema.parse((await me(inr.admin).get('/v2/wallet/summary')).body);
    expect(summary.currency).toBe('INR');
    const inrBalance = (await wallets(inr.orgId)).find((w) => w.unit === 'INR')!.minor;
    expect(summary.balanceMinor).toBe(inrBalance);
    const ledger = (await me(inr.admin).get('/v2/wallet/ledger?limit=100')).body.data as Array<{
      description: string;
    }>;
    expect(ledger.length).toBeGreaterThan(0);
    const statement = (await me(inr.admin).get('/v2/wallet/statement?limit=100')).body;
    expect(statement.currency).toBe('INR');
    expect(statement.summary.currentBalanceMinor).toBe(inrBalance);
    // the 50.00 dollar top-up is not in the rupee statement
    expect(
      statement.data.some(
        (r: { moneyInMinor: number; type: string }) =>
          r.type === 'topup' && r.moneyInMinor === 5000,
      ),
    ).toBe(false);
  });

  it('exports the statement with the currency in the column names', async () => {
    const res = await me(inr.admin).get('/v2/wallet/statement.csv');
    expect(res.status).toBe(200);
    expect(res.text.split('\n')[0]).toContain('(INR)');
  });

  it('quotes the price panel in rupees from the INR card', async () => {
    const r = (await me(inr.admin).get('/v2/wallet/pricing?country=IN')).body;
    expect(r.currency).toBe('INR');
    const marketing = r.categories.find((c: { category: string }) => c.category === 'marketing');
    expect(marketing.priceMinor).toBe(priceFromMargin(863_100, await platformMarginBps()));
    const usdPanel = (await me(usd.admin).get('/v2/wallet/pricing?country=IN')).body;
    expect(usdPanel.currency).toBe('USD');
  });

  it('judges the low-balance alert against a threshold converted to the wallet’s currency', async () => {
    const s = walletSummarySchema.parse((await me(inr.admin).get('/v2/wallet/summary')).body);
    const settings = (await ops('get', '/settings')).body as { lowBalanceThresholdMinor: number };
    expect(s.lowBalanceThresholdMinor).toBe(
      convertMinor(settings.lowBalanceThresholdMinor, await rate('USD'), await rate('INR')),
    );
  });
});

describe('the operator console', () => {
  it('lists each workspace with the wallet in its own currency, and totals each currency on its own line', async () => {
    const list = platformWalletListSchema.parse((await ops('get', '/workspaces?limit=100')).body);
    const row = (id: string) => list.data.find((r) => r.workspaceId === id)!;
    expect(row(inrUuid).currency).toBe('INR');
    const usdUuid = (
      await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [usd.orgId])
    ).rows[0].uuid;
    expect(row(usdUuid).currency).toBe('USD');
    // one row per workspace, however many wallets it holds
    expect(new Set(list.data.map((r) => r.workspaceId)).size).toBe(list.data.length);
    expect(list.totals.floatByCurrency.map((c) => c.currency)).toEqual(
      expect.arrayContaining(['INR', 'USD']),
    );
    const inrFloat = list.totals.floatByCurrency.find((c) => c.currency === 'INR')!.floatMinor;
    expect(inrFloat).toBeGreaterThan(0);
    expect(list.totals.floatMinor).toBe(
      list.totals.floatByCurrency.find((c) => c.currency === 'USD')!.floatMinor,
    );
  });

  it('shows every wallet of a workspace and the currencies it can switch to', async () => {
    const d = platformWalletDetailSchema.parse((await ops('get', `/workspaces/${inrUuid}`)).body);
    expect(d.currency).toBe('INR');
    expect(d.wallets.map((w) => w.currency).sort()).toEqual(['INR', 'USD']);
    expect(d.billableCurrencies).toEqual(expect.arrayContaining(['INR', 'USD']));
    expect(d.recent.every((r) => r.type !== 'topup' || r.balanceAfterMinor !== 5000)).toBe(true);
  });

  it('adds money by hand to the wallet the workspace is billed from', async () => {
    const before = (await wallets(inr.orgId)).find((w) => w.unit === 'INR')!.minor;
    const r = await ops('post', `/workspaces/${inrUuid}/adjust`)
      .set({ 'idempotency-key': `adj-${Date.now()}` })
      .send({ direction: 'credit', amount: '25.00', note: 'Goodwill credit in rupees' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await wallets(inr.orgId)).find((w) => w.unit === 'INR')!.minor).toBe(before + 2500);
    expect((await wallets(inr.orgId)).find((w) => w.unit === 'USD')!.minor).toBe(5000); // the dollars did not move
  });

  it('reconciles a workspace with two wallets against each wallet’s own ledger', async () => {
    const r = reconciliationSchema.parse((await ops('post', '/reconciliation')).body);
    expect(r.mismatches.filter((m) => m.workspaceId === inrUuid)).toEqual([]);
  });

  it('keeps the overview’s dollar figures apart from the rupee line', async () => {
    const o = platformWalletOverviewSchema.parse((await ops('get', '/overview')).body);
    expect(o.currency).toBe('USD');
    const rupees = o.otherCurrencies.find((c) => c.currency === 'INR');
    expect(rupees?.floatMinor).toBeGreaterThan(0);
  });

  it('switches a workspace’s billing currency with a reason, leaving the old wallet’s money where it is', async () => {
    const noNote = await ops('put', `/workspaces/${inrUuid}/currency`).send({
      currency: 'USD',
      note: '',
    });
    expect(noNote.status).toBe(422);
    const unsupported = await ops('put', `/workspaces/${inrUuid}/currency`).send({
      currency: 'EUR',
      note: 'Customer asked for euros',
    });
    expect(unsupported.status).toBe(422);
    expect(unsupported.body.code).toBe(ERROR_CODES.WALLET_CURRENCY_UNSUPPORTED);
    expect(
      (
        await ops('put', `/workspaces/${inrUuid}/currency`, h.supportToken).send({
          currency: 'USD',
          note: 'Customer asked for dollars',
        })
      ).status,
    ).toBe(403);

    const inrBalance = (await wallets(inr.orgId)).find((w) => w.unit === 'INR')!.minor;
    const r = await ops('put', `/workspaces/${inrUuid}/currency`).send({
      currency: 'USD',
      note: 'Customer asked for dollars',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({
      currency: 'USD',
      previousCurrency: 'INR',
      leftBehindMinor: inrBalance,
      changed: true,
    });
    // now billed from the dollar wallet; the rupees stay put
    expect(
      walletSummarySchema.parse((await me(inr.admin).get('/v2/wallet/summary')).body),
    ).toMatchObject({ currency: 'USD', balanceMinor: 5000 });
    expect((await wallets(inr.orgId)).find((w) => w.unit === 'INR')!.minor).toBe(inrBalance);
    const again = await ops('put', `/workspaces/${inrUuid}/currency`).send({
      currency: 'USD',
      note: 'Same again, no change',
    });
    expect(again.body).toMatchObject({ changed: false, leftBehindMinor: 0 });
    const log = await h.owner.query(
      `SELECT payload FROM wallet_platform_log WHERE event = 'platform.workspace_currency.changed' ORDER BY id DESC LIMIT 1`,
    );
    expect(log.rows[0].payload).toMatchObject({ from: 'INR', to: 'USD' });
    await setCurrency(inr.orgId, 'INR');
  });
});

describe('the reseller P&L', () => {
  const pnl = (q = '') =>
    h.api
      .http()
      .get(`/v2/platform/bsp/dashboard${q}`)
      .set({ authorization: `Bearer ${h.superToken}` });

  it('totals each currency on its own and offers the currencies that have activity', async () => {
    const usdView = bspDashboardSchema.parse((await pnl()).body);
    expect(usdView.currency).toBe('USD');
    expect(usdView.currencies).toEqual(expect.arrayContaining(['INR', 'USD']));
    const inrView = bspDashboardSchema.parse((await pnl('?currency=INR')).body);
    expect(inrView.currency).toBe('INR');
    expect(inrView.workspaces.length).toBeGreaterThan(0);
    // the INR workspace appears under INR, not under USD
    const names = (v: typeof usdView) => v.workspaces.map((w) => w.workspaceName);
    const inrName = (
      await h.owner.query(`SELECT name FROM organizations WHERE id = $1`, [inr.orgId])
    ).rows[0].name;
    expect(names(inrView)).toContain(inrName);
    expect(names(usdView)).not.toContain(inrName);
  });
});

describe('a bulk send', () => {
  it('is checked against the wallet and the price in the workspace’s currency', async () => {
    const { gate } = services(h);
    // an empty rupee wallet: refused, whatever the dollar wallet holds
    await h.owner.query(`UPDATE wallets SET balance = 0 WHERE org_id = $1 AND unit = 'INR'`, [
      inr.orgId,
    ]);
    await expect(
      gate.assertCanLaunch({
        orgId: inr.orgId,
        source: 'campaign',
        recipients: 10,
        category: 'marketing',
      }),
    ).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
    });
    // ₹100 covers ten ₹1.08 messages
    await fundIn(inr.orgId, 'INR', 10_000);
    await expect(
      gate.assertCanLaunch({
        orgId: inr.orgId,
        source: 'campaign',
        recipients: 10,
        phones: Array(10).fill(IN),
        category: 'marketing',
      }),
    ).resolves.toBeUndefined();
  });
});
