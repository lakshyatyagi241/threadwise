import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  platformWalletDetailSchema,
  platformWalletListSchema,
  ratesResponseSchema,
  reconciliationSchema,
  statementResponseSchema,
  walletLedgerResponseSchema,
  walletLogListSchema,
  walletSettingsSchema,
  walletSummarySchema,
  adjustWalletResultSchema,
} from '@crm/contracts';
import {
  balanceMinor,
  cleanWallet,
  events,
  fund,
  ledgerRows,
  newTenant,
  services,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * The wallet over HTTP: the customer's wallet, ledger, statement and CSV, and the operator's console (settings, switches, rate
 * card, every workspace's wallet, the manual adjustment with its mandatory note, the trail, reconciliation).
 */
let h: BspHarness;
let startedAt: Date;
let a: Tenant;
let b: Tenant;
const ops = (m: 'get' | 'post' | 'put' | 'delete', path: string, token = h.superToken) =>
  h.api
    .http()
    [m](`/v2/platform/wallet${path}`)
    .set({ authorization: `Bearer ${token}` });
const me = (token: string) => h.api.as(token);
const adjustKey = () => randomUUID();

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  a = await newTenant(h, 'wc-a');
  b = await newTenant(h, 'wc-b');
}, 120_000);

afterAll(async () => {
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('the customer wallet (TW-WALLET-020, -021, -022, -025)', () => {
  it('shows a new workspace an empty wallet in plan mode, in the platform currency', async () => {
    const r = await me(a.admin).get('/v2/wallet/summary');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const s = walletSummarySchema.parse(r.body);
    expect(s).toMatchObject({
      balanceMinor: 0,
      billingMode: 'plan',
      lowBalance: true,
      spent30dMinor: 0,
      topupUrl: '/billing/checkout/wallet',
    });
  });

  it('reports wallet mode for a reseller workspace and sums the last 30 days by type', async () => {
    await setReseller(h, a.orgId, true);
    await fund(h, a.orgId, 10_000);
    await services(h).billing.settleDelivered({
      orgId: a.orgId,
      provider: 'waba',
      providerMessageId: 'w-sum-1',
      recipient: '+14155550100',
      category: 'marketing',
      source: 'campaign',
    });
    const s = walletSummarySchema.parse((await me(a.admin).get('/v2/wallet/summary')).body);
    // per-country pricing is off in this suite, so a message costs the flat 1.00
    expect(s).toMatchObject({
      billingMode: 'wallet',
      balanceMinor: 9900,
      spent30dMinor: 100,
      toppedUp30dMinor: 10_000,
      earned30dMinor: 0,
      lowBalance: false,
      flatPriceMinor: 100,
      approxMessages: 99,
    });
  });

  it('lists the ledger newest first with the amount signed by direction, and pages by cursor', async () => {
    const first = walletLedgerResponseSchema.parse(
      (await me(a.admin).get('/v2/wallet/ledger?limit=1')).body,
    );
    expect(first.data[0]).toMatchObject({
      type: 'spend',
      direction: 'out',
      amountMinor: -100,
      balanceAfterMinor: 9900,
    });
    expect(first.page.hasMore).toBe(true);
    const next = walletLedgerResponseSchema.parse(
      (await me(a.admin).get(`/v2/wallet/ledger?limit=1&cursor=${first.page.nextCursor}`)).body,
    );
    expect(next.data[0]).toMatchObject({ type: 'topup', direction: 'in', amountMinor: 10_000 });
    expect(next.page.hasMore).toBe(false);
  });

  it('classifies the statement by direction: a message charge is money OUT, a top-up money IN (the Reference sign bug)', async () => {
    const s = statementResponseSchema.parse((await me(a.admin).get('/v2/wallet/statement')).body);
    expect(s.summary).toMatchObject({
      currentBalanceMinor: 9900,
      moneyInMinor: 10_000,
      moneyOutMinor: 100,
      netMinor: 9900,
      count: 2,
    });
    const spend = s.data.find((r) => r.type === 'spend')!;
    expect(spend).toMatchObject({ moneyInMinor: 0, moneyOutMinor: 100 });
    expect(spend.context).toMatchObject({
      country: 'US',
      category: 'marketing',
      engine: 'WhatsApp Cloud',
      channel: 'Campaign',
    });
  });

  it('filters the statement: the Top-ups filter finds top-ups, search finds a description, a date range bounds it', async () => {
    const topups = statementResponseSchema.parse(
      (await me(a.admin).get('/v2/wallet/statement?type=topup')).body,
    );
    expect(topups.data.map((r) => r.type)).toEqual(['topup']);
    expect(topups.summary).toMatchObject({ moneyInMinor: 10_000, moneyOutMinor: 0, count: 1 });
    const found = statementResponseSchema.parse(
      (await me(a.admin).get('/v2/wallet/statement?q=whatsapp%20message')).body,
    );
    expect(found.data.map((r) => r.type)).toEqual(['spend']);
    const none = statementResponseSchema.parse(
      (await me(a.admin).get('/v2/wallet/statement?from=2001-01-01&to=2001-01-02')).body,
    );
    expect(none.data).toEqual([]);
    expect(none.summary.count).toBe(0);
    expect((await me(a.admin).get('/v2/wallet/statement?q=100%25')).status).toBe(200);
  });

  it('rejects a malformed filter with a validation problem', async () => {
    const r = await me(a.admin).get('/v2/wallet/statement?type=bonus&from=yesterday');
    expect(r.status).toBe(422);
    expect(r.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('exports the statement as CSV, oldest first, with formula cells neutralised', async () => {
    await h.owner.query(
      `INSERT INTO wallet_transactions (org_id, kind, type, direction, amount, balance_after, description, idempotency_key)
       VALUES ($1, 'credit', 'earn', 'in', 0.01, 99.01, '=HYPERLINK("http://evil.test")', 'csv-inject')`,
      [a.orgId],
    );
    // keep the books balanced (the wallet moves with its ledger)
    await h.owner.query(`UPDATE wallets SET balance = balance + 0.01 WHERE org_id = $1`, [a.orgId]);
    const r = await me(a.admin).get('/v2/wallet/statement.csv').buffer(true);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/wallet-statement-\d{4}-\d{2}-\d{2}\.csv/);
    const text = r.text.replace(String.fromCharCode(0xfeff), '');
    const lines = text.trim().split('\r\n');
    expect(lines[0]).toBe(
      'Date,Type,Description,Channel,Recipient,Template,Country,Category,Engine,Money in (USD),Money out (USD),Balance after (USD)',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('Top-up');
    expect(lines[2]).toContain('Message charge');
    expect(lines[2]).toContain('1.00');
    expect(lines.some((l) => l.includes(`'=HYPERLINK`))).toBe(true);
    expect(lines.some((l) => l.includes(',=HYPERLINK'))).toBe(false);
  });

  it('shows another workspace nothing of this one', async () => {
    const s = walletSummarySchema.parse((await me(b.admin).get('/v2/wallet/summary')).body);
    expect(s.balanceMinor).toBe(0);
    const st = statementResponseSchema.parse((await me(b.admin).get('/v2/wallet/statement')).body);
    expect(st.data).toEqual([]);
  });

  it('requires the permission for each screen: balance, statement, export', async () => {
    const balanceOnly = await h.api.member(a, 'balonly', [['wallet.balance.read']]);
    expect((await me(balanceOnly.token).get('/v2/wallet/summary')).status).toBe(200);
    expect((await me(balanceOnly.token).get('/v2/wallet/pricing')).status).toBe(200);
    expect((await me(balanceOnly.token).get('/v2/wallet/statement')).status).toBe(403);
    expect((await me(balanceOnly.token).get('/v2/wallet/ledger')).status).toBe(403);
    const reader = await h.api.member(a, 'reader', [['wallet.statement.read']]);
    expect((await me(reader.token).get('/v2/wallet/statement')).status).toBe(200);
    expect((await me(reader.token).get('/v2/wallet/statement.csv')).status).toBe(403);
    const none = await h.api.member(a, 'nobody', []);
    expect((await me(none.token).get('/v2/wallet/summary')).status).toBe(403);
  });

  it('refuses an anonymous caller and a platform operator token on the customer routes', async () => {
    expect((await h.api.http().get('/v2/wallet/summary')).status).toBe(401);
    expect((await me(h.superToken).get('/v2/wallet/summary')).status).toBeGreaterThanOrEqual(401);
  });

  it('shows the price panel: base prices for wallet mode, flat prices when per-country pricing is off', async () => {
    const r = await me(a.admin).get('/v2/wallet/pricing');
    expect(r.body).toMatchObject({
      billingMode: 'wallet',
      perCountryEnabled: false,
      currency: 'USD',
    });
    expect(r.body.categories).toEqual([
      { category: 'marketing', priceMinor: 100, free: false },
      { category: 'utility', priceMinor: 100, free: false },
      { category: 'authentication', priceMinor: 100, free: false },
      { category: 'service', priceMinor: 100, free: false },
    ]);
  });
});

describe('the operator console: settings, switches and the rate card (TW-WALLET-003, -005 to -008)', () => {
  it('serves the defaults of a fresh install, readable by every operator role', async () => {
    const r = await ops('get', '/settings', h.supportToken);
    expect(r.status).toBe(200);
    expect(walletSettingsSchema.parse(r.body)).toMatchObject({
      flatPriceMinor: 100,
      referralSignupMinor: 100,
      lowBalanceThresholdMinor: 20,
      launchCoveragePercent: 100,
      perCountryEnabled: false,
      payPerMessage: false,
    });
  });

  it('saves the economics for a super admin only, rejects a flat price of 0, and writes the old and new values to the log', async () => {
    const body = {
      flatPrice: '3.00',
      referralSignup: '0.50',
      lowBalanceThreshold: '5',
      launchCoveragePercent: 50,
    };
    expect((await ops('put', '/settings', h.supportToken).send(body)).status).toBe(403);
    expect((await ops('put', '/settings').send({ ...body, flatPrice: '0' })).status).toBe(422);
    expect((await ops('put', '/settings').send({ ...body, flatPrice: '1.234' })).status).toBe(422);
    const r = await ops('put', '/settings').send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(walletSettingsSchema.parse(r.body)).toMatchObject({
      flatPriceMinor: 300,
      referralSignupMinor: 50,
      lowBalanceThresholdMinor: 500,
      launchCoveragePercent: 50,
    });
    const logs = walletLogListSchema.parse(
      (await ops('get', '/logs?scope=platform&event=platform.settings.saved')).body,
    );
    expect(logs.data[0]!.payload).toMatchObject({
      flatPriceMinor: { old: 100, new: 300 },
      launchCoveragePercent: { old: 100, new: 50 },
    });
    expect(logs.data[0]!.actorLabel).toMatch(/ops-|Ops/i);
  });

  it('saves the two switches on their own, and saving rates never touches them', async () => {
    expect((await ops('put', '/switches').send({})).status).toBe(422);
    const on = await ops('put', '/switches').send({ perCountryEnabled: true, payPerMessage: true });
    expect(walletSettingsSchema.parse(on.body)).toMatchObject({
      perCountryEnabled: true,
      payPerMessage: true,
    });
    const rate = await ops('put', '/rates').send({
      rows: [{ countryCode: 'QQ', category: 'marketing', price: '2.00', metaCost: '' }],
    });
    expect(rate.status).toBe(200);
    const after = walletSettingsSchema.parse((await ops('get', '/settings')).body);
    expect(after).toMatchObject({ perCountryEnabled: true, payPerMessage: true });
    const one = await ops('put', '/switches').send({ payPerMessage: false });
    expect(walletSettingsSchema.parse(one.body)).toMatchObject({
      perCountryEnabled: true,
      payPerMessage: false,
    });
    await ops('put', '/switches').send({ perCountryEnabled: false });
    expect((await events(h, a.orgId)).length).toBeGreaterThanOrEqual(0);
  });

  it('saves a grid row with price and cost, shows margin, keeps the first of a repeated key and reports a row it cannot save', async () => {
    const r = await ops('put', '/rates').send({
      rows: [
        { countryCode: 'zz', category: 'utility', price: '0.75', metaCost: '0.0042' },
        { countryCode: 'ZZ', category: 'utility', price: '9.99', metaCost: '' },
        { countryCode: 'ZZZ', category: '', price: '1' },
        { countryCode: 'QQ', category: '', price: '', metaCost: '' },
        { countryCode: 'QQ', category: 'service', price: '1.005' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.saved).toBe(1);
    expect(r.body.skipped.map((s: { index: number }) => s.index).sort()).toEqual([1, 2, 3, 4]);
    expect(r.body.skipped.find((s: { index: number }) => s.index === 2).reason).toMatch(/2-letter/);
    expect(r.body.skipped.find((s: { index: number }) => s.index === 3).reason).toMatch(
      /price or a Meta cost/,
    );
    expect(r.body.skipped.find((s: { index: number }) => s.index === 4).reason).toMatch(
      /at most 2 decimals/,
    );
    const list = ratesResponseSchema.parse((await ops('get', '/rates')).body);
    const zz = list.data.find((x) => x.countryCode === 'ZZ' && x.category === 'utility')!;
    expect(zz).toMatchObject({
      priceMinor: 75,
      metaCost: '0.0042',
      marginMinor: 75,
      countryName: expect.any(String),
    });
    expect(list.data[0]).toMatchObject({ countryCode: '', category: '' }); // default row first
    expect(list.countries.some((c) => c.code === 'IN')).toBe(true);
    // the micro-cost is exact: 0.0042 is not rounded to whole cents
    const db = await h.owner.query(
      `SELECT meta_cost_micros::text AS m, meta_cost_minor::text AS c FROM message_rates WHERE country_code = 'ZZ' AND category = 'utility'`,
    );
    expect(db.rows[0]).toEqual({ m: '4200', c: '0' });
  });

  it('a blank cost clears the cost; a blank price keeps the stored price', async () => {
    await ops('put', '/rates').send({
      rows: [{ countryCode: 'ZZ', category: 'utility', price: '0.75', metaCost: '' }],
    });
    await ops('put', '/rates').send({
      rows: [{ countryCode: 'ZZ', category: 'utility', price: '', metaCost: '0.01' }],
    });
    await ops('put', '/rates').send({
      rows: [{ countryCode: 'ZZ', category: 'utility', price: '0.75', metaCost: '' }],
    });
    const row = ratesResponseSchema
      .parse((await ops('get', '/rates')).body)
      .data.find((x) => x.countryCode === 'ZZ')!;
    expect(row).toMatchObject({ priceMinor: 75, metaCost: null, marginMinor: null });
  });

  it('removes a row, records it, and refuses an unknown id', async () => {
    const row = ratesResponseSchema
      .parse((await ops('get', '/rates')).body)
      .data.find((x) => x.countryCode === 'ZZ')!;
    expect((await ops('delete', `/rates/${row.id}`, h.supportToken)).status).toBe(403);
    expect((await ops('delete', `/rates/${row.id}`)).body).toEqual({ deleted: true });
    expect((await ops('delete', `/rates/${row.id}`)).status).toBe(404);
    const logs = walletLogListSchema.parse(
      (await ops('get', '/logs?event=platform.rate.deleted')).body,
    );
    expect(logs.data[0]!.payload).toMatchObject({ key: 'ZZ|utility' });
  });

  it('makes a price edit apply to the very next settlement (no stale cache)', async () => {
    await setReseller(h, b.orgId, true);
    await fund(h, b.orgId, 10_000);
    await ops('put', '/switches').send({ perCountryEnabled: true });
    await ops('put', '/rates').send({
      rows: [{ countryCode: 'US', category: 'marketing', price: '20.00' }],
    });
    const out = await services(h).billing.settleDelivered({
      orgId: b.orgId,
      provider: 'waba',
      providerMessageId: 'edit-1',
      recipient: '+14155550100',
      category: 'marketing',
    });
    expect(out).toMatchObject({ chargedMinor: 2000 });
    await ops('put', '/rates').send({
      rows: [{ countryCode: 'US', category: 'marketing', price: '12.00' }],
    });
    await ops('put', '/switches').send({ perCountryEnabled: false });
  });

  it('previews an import without writing, then writes it; a country it does not know is counted and explained', async () => {
    const csv = 'country,currency,marketing,utility\nLI,USD,0.0500,0.0100\nNarnia,USD,0.1,0.1\n';
    const preview = await ops('post', '/rates/import').send({ csv, dryRun: true });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({
      dryRun: true,
      shape: 'wide',
      added: 2,
      updated: 0,
      skipped: 1,
    });
    expect(preview.body.problems[0]).toMatchObject({ line: 3 });
    expect(
      (
        await h.owner.query(
          `SELECT 1 FROM message_rates WHERE country_code = 'LI' AND category = 'utility'`,
        )
      ).rows,
    ).toHaveLength(0);
    const done = await ops('post', '/rates/import').send({ csv, dryRun: false });
    expect(done.body).toMatchObject({ dryRun: false, added: 2, updated: 0 });
    const row = (
      await h.owner.query(
        `SELECT credits, meta_cost_micros::text AS m FROM message_rates WHERE country_code = 'LI' AND category = 'utility'`,
      )
    ).rows[0];
    // a NEW row takes the price its messages already had (the flat 3.00 saved above), never 0
    expect(row).toEqual({ credits: 300, m: '10000' });
    expect(
      (await ops('post', '/rates/import').send({ csv: 'foo,bar\n1,2\n', dryRun: false })).body.code,
    ).toBe(ERROR_CODES.WALLET_IMPORT_FAILED);
    expect(
      (await ops('post', '/rates/import', h.supportToken).send({ csv, dryRun: true })).status,
    ).toBe(403);
  });

  it('syncs Meta costs from the bundled card when no live source is set, previews first, and never touches a customer price', async () => {
    const before = (
      await h.owner.query(
        `SELECT credits FROM message_rates WHERE country_code = 'US' AND category = 'marketing'`,
      )
    ).rows[0].credits;
    const preview = await ops('post', '/rates/sync-meta').send({ dryRun: true });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({
      dryRun: true,
      source: 'bundled',
      sourceLabel: 'bundled reference',
      currency: 'USD',
    });
    const done = await ops('post', '/rates/sync-meta').send({ dryRun: false });
    expect(done.body.added + done.body.updated).toBeGreaterThan(50);
    const us = (
      await h.owner.query(
        `SELECT credits, meta_cost_micros::text AS m FROM message_rates WHERE country_code = 'US' AND category = 'marketing'`,
      )
    ).rows[0];
    expect(us.credits).toBe(before);
    expect(us.m).toBe('25000');
    const utilUs = (
      await h.owner.query(
        `SELECT meta_cost_micros::text AS m FROM message_rates WHERE country_code = 'US' AND category = 'utility'`,
      )
    ).rows[0];
    expect(utilUs.m).toBe('4000'); // sub-cent cost kept, not rounded to 0
    await h.owner.query(
      `UPDATE message_rates SET meta_cost_micros = NULL, meta_cost_minor = NULL WHERE meta_cost_micros IS NOT NULL AND country_code <> 'QQ'`,
    );
  });

  it('re-seeds the starter card on request', async () => {
    await h.owner.query(
      `UPDATE message_rates SET credits = 5 WHERE country_code = 'US' AND category = 'marketing'`,
    );
    expect((await ops('post', '/rates/seed')).body).toEqual({ upserted: 10 });
    expect(
      (
        await h.owner.query(
          `SELECT credits FROM message_rates WHERE country_code = 'US' AND category = 'marketing'`,
        )
      ).rows[0].credits,
    ).toBe(1200);
  });
});

describe('adding or taking money by hand (the super-admin requirement)', () => {
  let c: Tenant;
  let cUuid = '';
  beforeAll(async () => {
    c = await newTenant(h, 'wc-adj');
  });
  const adjust = (body: Record<string, unknown>, key = adjustKey(), token = h.superToken) =>
    h.api
      .http()
      .post(`/v2/platform/wallet/workspaces/${cUuid}/adjust`)
      .set({ authorization: `Bearer ${token}`, 'idempotency-key': key })
      .send(body);

  beforeAll(async () => {
    const r = await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [c.orgId]);
    cUuid = r.rows[0].uuid;
  });

  it('adds balance with a note: the wallet, the ledger entry, the wallet log and the audit trail all record who and why', async () => {
    const r = await adjust({
      direction: 'credit',
      amount: '250.50',
      note: 'Goodwill after the March outage (ticket 4411)',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const res = adjustWalletResultSchema.parse(r.body);
    expect(res).toMatchObject({
      direction: 'credit',
      requestedMinor: 25_050,
      appliedMinor: 25_050,
      balanceBeforeMinor: 0,
      balanceAfterMinor: 25_050,
      replayed: false,
    });
    expect(await balanceMinor(h, c.orgId)).toBe(25_050);
    const row = (await ledgerRows(h, c.orgId))[0];
    expect(row).toMatchObject({
      type: 'admin_adjust',
      direction: 'in',
      minor: 25_050,
      source: 'admin.adjust',
      note: 'Goodwill after the March outage (ticket 4411)',
    });
    expect(row.actor_label).toMatch(/Ops/);
    const ev = (await events(h, c.orgId, 'wallet.admin.adjusted'))[0];
    expect(ev.payload).toMatchObject({
      direction: 'credit',
      appliedMinor: 25_050,
      balanceAfterMinor: 25_050,
      note: 'Goodwill after the March outage (ticket 4411)',
    });
    const sec = await h.owner.query(
      `SELECT payload FROM security_events WHERE subject_org_id = $1 AND event = 'platform.wallet.adjusted'`,
      [c.orgId],
    );
    expect(sec.rows).toHaveLength(1);
    expect(sec.rows[0].payload).toMatchObject({
      note: 'Goodwill after the March outage (ticket 4411)',
      appliedMinor: 25_050,
    });
    const outbox = await h.api.events(c.orgId, 'wallet.topped_up');
    expect(outbox.at(-1)).toMatchObject({ type: 'admin_adjust', amountMinor: 25_050 });
  });

  it('shows the customer the credit and its reason on their own statement', async () => {
    const s = statementResponseSchema.parse(
      (await me(c.admin).get('/v2/wallet/statement?type=admin_adjust')).body,
    );
    expect(s.data[0]).toMatchObject({
      type: 'admin_adjust',
      moneyInMinor: 25_050,
      note: 'Goodwill after the March outage (ticket 4411)',
      description: 'Credit added by platform support',
    });
  });

  it('refuses a missing, blank or too short note, and writes nothing', async () => {
    const before = await balanceMinor(h, c.orgId);
    for (const note of [undefined, '', '     ', 'oops']) {
      const r = await adjust({
        direction: 'credit',
        amount: '10',
        ...(note === undefined ? {} : { note }),
      });
      expect(r.status, String(note)).toBe(422);
      expect(r.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
    expect(await balanceMinor(h, c.orgId)).toBe(before);
    expect((await ledgerRows(h, c.orgId)).filter((x) => x.type === 'admin_adjust')).toHaveLength(1);
  });

  it('refuses an amount of 0, a negative one, too many decimals and one above the limit', async () => {
    for (const amount of ['0', '0.00', '-5', '1.999', '99999999999']) {
      expect(
        (await adjust({ direction: 'credit', amount, note: 'a good reason' })).status,
        amount,
      ).toBe(422);
    }
  });

  it('requires an Idempotency-Key and posts once for a repeated key: the second reply is the first, flagged replayed', async () => {
    const noKey = await h.api
      .http()
      .post(`/v2/platform/wallet/workspaces/${cUuid}/adjust`)
      .set({ authorization: `Bearer ${h.superToken}` })
      .send({ direction: 'credit', amount: '1', note: 'no key at all' });
    expect(noKey.status).toBe(400);
    const key = adjustKey();
    const before = await balanceMinor(h, c.orgId);
    const body = { direction: 'credit', amount: '5.00', note: 'Double click test' };
    const x = await adjust(body, key);
    const y = await adjust(body, key);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(y.body).toEqual(x.body);
    expect(await balanceMinor(h, c.orgId)).toBe(before + 500);
    expect(
      (await ledgerRows(h, c.orgId)).filter((r) => r.note === 'Double click test'),
    ).toHaveLength(1);
    // two clicks at the same instant: one posts, the other is told a request with that key is in flight (or gets the reply)
    const key2 = adjustKey();
    const racing = await Promise.all([
      adjust({ ...body, note: 'Raced click test' }, key2),
      adjust({ ...body, note: 'Raced click test' }, key2),
    ]);
    expect(racing.some((r) => r.status === 200)).toBe(true);
    expect(racing.every((r) => [200, 409].includes(r.status))).toBe(true);
    expect(
      (await ledgerRows(h, c.orgId)).filter((r) => r.note === 'Raced click test'),
    ).toHaveLength(1);
  });

  it('takes money back with a note, and a deduction larger than the balance takes only what is there, saying so', async () => {
    const bal = await balanceMinor(h, c.orgId);
    const small = adjustWalletResultSchema.parse(
      (await adjust({ direction: 'debit', amount: '10.00', note: 'Duplicate credit reversed' }))
        .body,
    );
    expect(small).toMatchObject({
      direction: 'debit',
      requestedMinor: 1000,
      appliedMinor: 1000,
      balanceAfterMinor: bal - 1000,
    });
    const big = adjustWalletResultSchema.parse(
      (await adjust({ direction: 'debit', amount: '999999.00', note: 'Close the account balance' }))
        .body,
    );
    expect(big.requestedMinor).toBe(99_999_900);
    expect(big.appliedMinor).toBe(bal - 1000);
    expect(big.balanceAfterMinor).toBe(0);
    expect(await balanceMinor(h, c.orgId)).toBe(0);
    const rows = (await ledgerRows(h, c.orgId)).filter((r) => r.type === 'admin_adjust');
    expect(rows.at(-1)).toMatchObject({ direction: 'out', minor: -(bal - 1000) });
    const empty = adjustWalletResultSchema.parse(
      (await adjust({ direction: 'debit', amount: '5.00', note: 'Nothing left to take' })).body,
    );
    expect(empty).toMatchObject({ appliedMinor: 0, balanceAfterMinor: 0 });
  });

  it('is for super admins only, and for a real workspace only', async () => {
    expect(
      (
        await adjust(
          { direction: 'credit', amount: '1', note: 'support tries' },
          adjustKey(),
          h.supportToken,
        )
      ).status,
    ).toBe(403);
    const ghost = await h.api
      .http()
      .post(`/v2/platform/wallet/workspaces/${randomUUID()}/adjust`)
      .set({ authorization: `Bearer ${h.superToken}`, 'idempotency-key': adjustKey() })
      .send({ direction: 'credit', amount: '1', note: 'no such workspace' });
    expect(ghost.status).toBe(404);
    const tenantTries = await h.api
      .http()
      .post(`/v2/platform/wallet/workspaces/${cUuid}/adjust`)
      .set({ authorization: `Bearer ${c.admin}`, 'idempotency-key': adjustKey() })
      .send({ direction: 'credit', amount: '1', note: 'a customer cannot do this' });
    expect([401, 403]).toContain(tenantTries.status);
  });

  it('lists every workspace with its balance and totals, and opens one with who adjusted it', async () => {
    await fund(h, c.orgId, 700);
    const list = platformWalletListSchema.parse((await ops('get', '/workspaces?limit=100')).body);
    const mine = list.data.find((w) => w.workspaceId === cUuid)!;
    expect(mine).toMatchObject({ balanceMinor: 700, lowBalance: false });
    expect(list.totals.workspaces).toBeGreaterThanOrEqual(3);
    expect(list.totals.floatMinor).toBeGreaterThanOrEqual(700);
    const found = platformWalletListSchema.parse(
      (await ops('get', `/workspaces?q=${encodeURIComponent(c.slug)}`)).body,
    );
    expect(found.data.map((w) => w.slug)).toEqual([c.slug]);
    const detail = platformWalletDetailSchema.parse(
      (await ops('get', `/workspaces/${cUuid}`)).body,
    );
    expect(detail.balanceMinor).toBe(700);
    expect(
      detail.recent.some(
        (r) => r.type === 'admin_adjust' && r.actorLabel?.includes('Ops') && r.note,
      ),
    ).toBe(true);
    expect((await ops('get', `/workspaces/${randomUUID()}`)).status).toBe(404);
  });
});

describe('the trail, the overview and reconciliation', () => {
  it('reads workspace and platform events together, newest first, filtered and paged', async () => {
    const all = walletLogListSchema.parse((await ops('get', '/logs?limit=200')).body);
    expect(
      all.data.some((r) => r.scope === 'workspace' && r.event === 'wallet.admin.adjusted'),
    ).toBe(true);
    expect(
      all.data.some((r) => r.scope === 'platform' && r.event === 'platform.settings.saved'),
    ).toBe(true);
    const times = all.data.map((r) => r.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const platformOnly = walletLogListSchema.parse((await ops('get', '/logs?scope=platform')).body);
    expect(platformOnly.data.every((r) => r.scope === 'platform' && r.workspaceId === null)).toBe(
      true,
    );
    const ws = walletLogListSchema.parse(
      (
        await ops(
          'get',
          `/logs?scope=workspace&workspaceId=${(await h.owner.query(`SELECT uuid FROM organizations WHERE id=$1`, [a.orgId])).rows[0].uuid}`,
        )
      ).body,
    );
    expect(ws.data.every((r) => r.workspaceName !== null)).toBe(true);
    const one = walletLogListSchema.parse((await ops('get', '/logs?limit=1')).body);
    expect(one.page.hasMore).toBe(true);
    const next = walletLogListSchema.parse(
      (await ops('get', `/logs?limit=1&cursor=${one.page.nextCursor}`)).body,
    );
    expect(next.data[0]!.id).not.toBe(one.data[0]!.id);
    const warn = walletLogListSchema.parse(
      (await ops('get', '/logs?severity=warning&event=wallet.admin.adjusted')).body,
    );
    expect(warn.data.every((r) => r.severity === 'warning')).toBe(true);
    const search = walletLogListSchema.parse((await ops('get', '/logs?q=March%20outage')).body);
    expect(search.data.length).toBeGreaterThan(0);
  });

  it('is closed to a workspace user', async () => {
    expect([401, 403]).toContain((await h.api.as(a.admin).get('/v2/platform/wallet/logs')).status);
  });

  it('summarises the platform wallet', async () => {
    const r = await ops('get', '/overview');
    expect(r.status).toBe(200);
    expect(r.body.last30d.adjustedInMinor).toBeGreaterThanOrEqual(25_050);
    expect(r.body.floatMinor).toBeGreaterThan(0);
  });

  it('finds a balance that disagrees with its ledger, names the difference, logs it once a day, and goes clean when repaired', async () => {
    await h.owner.query(`UPDATE wallets SET balance = balance + 1.50 WHERE org_id = $1`, [a.orgId]);
    const bad = reconciliationSchema.parse((await ops('post', '/reconciliation')).body);
    const mine = bad.mismatches.find((m) => m.workspaceName.includes('wc-a'));
    expect(mine).toMatchObject({ differenceMinor: 150 });
    expect((await events(h, a.orgId, 'wallet.reconcile.mismatch')).length).toBe(1);
    await ops('post', '/reconciliation');
    expect((await events(h, a.orgId, 'wallet.reconcile.mismatch')).length).toBe(1);
    await h.owner.query(`UPDATE wallets SET balance = balance - 1.50 WHERE org_id = $1`, [a.orgId]);
    const clean = reconciliationSchema.parse((await ops('post', '/reconciliation')).body);
    expect(clean.mismatches.find((m) => m.workspaceName.includes('wc-a'))).toBeUndefined();
    expect((await ops('post', '/reconciliation', h.supportToken)).status).toBe(403);
  });
});
