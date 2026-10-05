import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, marginsResponseSchema, pricePreviewSchema } from '@crm/contracts';
import { MetaRateCardService } from '../../../src/modules/wallet-message-billing/meta-rate-card.service';
import {
  balanceMinor,
  charges,
  cleanWallet,
  events,
  fund,
  newTenant,
  services,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * Margin pricing end to end: Meta cost + our margin, per country and category, from the platform default, then the plan, then a
 * single workspace's override (which needs a reason). Liechtenstein (+423) is the test country: nothing else prices it.
 */
let h: BspHarness;
let startedAt: Date;
let t: Tenant;
let tUuid = '';
let n = 0;
const LI = '+423 660 1234';
const ops = (m: 'get' | 'post' | 'put' | 'delete', path: string, token = h.superToken) =>
  h.api
    .http()
    [m](`/v2/platform/wallet${path}`)
    .set({ authorization: `Bearer ${token}` });
const settle = () =>
  services(h).billing.settleDelivered({
    orgId: t.orgId,
    provider: 'waba',
    providerMessageId: `m-${Date.now()}-${n++}`,
    recipient: LI,
    category: 'marketing',
  });

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  t = await newTenant(h, 'mg');
  tUuid = (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [t.orgId])).rows[0]
    .uuid;
  // a plan in the catalogue for the workspace to be on (a free plan needs no price)
  await h.owner.query(
    `INSERT INTO plans (slug, name, kind, is_free) VALUES ('mgplan', 'MG Plan', 'plan', true) ON CONFLICT (slug) DO NOTHING`,
  );
  await h.owner.query(`UPDATE organizations SET plan = 'mgplan' WHERE id = $1`, [t.orgId]);
  await setReseller(h, t.orgId, true);
  await fund(h, t.orgId, 100_000);
  // Meta's cost for Liechtenstein marketing is 0.10; the typed fixed price is 5.00
  const r = await ops('put', '/rates').send({
    rows: [{ countryCode: 'LI', category: 'marketing', price: '5.00', metaCost: '0.10' }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  await h.owner.query(
    `DELETE FROM plan_message_margins WHERE plan_slug <> '' OR country_code <> '' OR category <> ''`,
  );
  await h.owner.query(`UPDATE organizations SET plan = 'starter' WHERE id = $1`, [t.orgId]);
  await h.owner.query(`DELETE FROM plans WHERE slug = 'mgplan'`);
  await h.owner.query(
    `INSERT INTO plan_message_margins (plan_slug, country_code, category, margin_bps) VALUES ('', '', '', 2000) ON CONFLICT DO NOTHING`,
  );
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('pricing mode', () => {
  it('keeps typed prices until an operator turns margin pricing on, and says so in the preview', async () => {
    expect((await ops('get', '/settings')).body.pricingMode).toBe('fixed');
    const before = pricePreviewSchema.parse(
      (await ops('get', `/pricing/preview?workspaceId=${tUuid}&country=LI&category=marketing`))
        .body,
    );
    expect(before).toMatchObject({ mode: 'fixed', basis: 'fixed', priceMinor: 100 }); // per-country off: the flat 1.00
    expect((await settle()).status).toBe('charged');
    expect((await charges(h, t.orgId))[0]).toMatchObject({ price_credits: 100 });
  });

  it('switches to margin pricing for super admins only and logs it', async () => {
    expect(
      (await ops('put', '/switches', h.supportToken).send({ pricingMode: 'margin' })).status,
    ).toBe(403);
    const r = await ops('put', '/switches').send({ pricingMode: 'margin' });
    expect(r.body.pricingMode).toBe('margin');
    expect((await ops('put', '/switches').send({ pricingMode: 'bogus' })).status).toBe(422);
  });
});

describe('platform default, plan margin, workspace override', () => {
  it('prices Meta cost 0.10 + the platform default 20% = 0.12 and charges exactly that', async () => {
    const p = pricePreviewSchema.parse(
      (await ops('get', `/pricing/preview?workspaceId=${tUuid}&country=LI&category=marketing`))
        .body,
    );
    expect(p).toMatchObject({
      mode: 'margin',
      basis: 'margin',
      metaCost: '0.10',
      marginBps: 2000,
      marginSource: 'platform',
      priceMinor: 12,
    });
    const before = await balanceMinor(h, t.orgId);
    expect(await settle()).toMatchObject({ status: 'charged', chargedMinor: 12 });
    expect(await balanceMinor(h, t.orgId)).toBe(before - 12);
    const last = (await charges(h, t.orgId)).at(-1);
    expect(last).toMatchObject({ price_credits: 12, credits: 12 });
  });

  it('lists the platform default margins with the price each gives', async () => {
    const r = marginsResponseSchema.parse((await ops('get', '/margins')).body);
    expect(r.scope).toEqual({ type: 'platform' });
    expect(r.data[0]).toMatchObject({ countryCode: '', category: '', marginBps: 2000 });
    expect(r.plans.length).toBeGreaterThan(0);
  });

  it('a margin set for the workspace plan beats the platform default', async () => {
    const plan = (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [t.orgId]))
      .rows[0].plan as string;
    const saved = await ops('put', '/margins').send({
      planSlug: plan,
      rows: [{ countryCode: 'LI', category: 'marketing', margin: '50' }],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ saved: 1, removed: 0 });
    const p = pricePreviewSchema.parse(
      (await ops('get', `/pricing/preview?workspaceId=${tUuid}&country=LI&category=marketing`))
        .body,
    );
    expect(p).toMatchObject({
      marginBps: 5000,
      marginSource: 'plan',
      priceMinor: 15,
      planSlug: plan,
    });
    expect(await settle()).toMatchObject({ chargedMinor: 15 });
    // another plan's workspace is unaffected: the preview without a workspace uses the platform default
    const generic = pricePreviewSchema.parse(
      (await ops('get', '/pricing/preview?country=LI&category=marketing')).body,
    );
    expect(generic).toMatchObject({ marginSource: 'platform', priceMinor: 12 });
  });

  it('refuses a workspace override without a reason, and with a bad margin reports the row', async () => {
    const noNote = await ops('put', `/workspaces/${tUuid}/margins`).send({
      rows: [{ countryCode: 'LI', category: 'marketing', margin: '100' }],
    });
    expect(noNote.status).toBe(422);
    expect(noNote.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    const short = await ops('put', `/workspaces/${tUuid}/margins`).send({
      rows: [{ countryCode: 'LI', category: 'marketing', margin: '100' }],
      note: 'no',
    });
    expect(short.status).toBe(422);
    const bad = await ops('put', `/workspaces/${tUuid}/margins`).send({
      rows: [
        { countryCode: 'LI', category: 'marketing', margin: 'lots' },
        { countryCode: 'LIE', category: '', margin: '10' },
      ],
      note: 'Negotiated rate',
    });
    expect(bad.status).toBe(200);
    expect(bad.body).toMatchObject({ saved: 0 });
    expect(bad.body.skipped).toHaveLength(2);
    expect(
      (
        await ops('put', `/workspaces/${tUuid}/margins`, h.supportToken).send({
          rows: [{ margin: '1' }],
          note: 'support tries',
        })
      ).status,
    ).toBe(403);
  });

  it('a workspace override beats its plan: 100% margin = 0.20, recorded with who and why in the workspace log and the audit trail', async () => {
    const r = await ops('put', `/workspaces/${tUuid}/margins`).send({
      rows: [{ countryCode: 'LI', category: 'marketing', margin: '100' }],
      note: 'Enterprise deal: pay Meta cost x2 (contract 7781)',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ saved: 1 });
    const p = pricePreviewSchema.parse(
      (await ops('get', `/pricing/preview?workspaceId=${tUuid}&country=LI&category=marketing`))
        .body,
    );
    expect(p).toMatchObject({ marginBps: 10_000, marginSource: 'workspace', priceMinor: 20 });
    expect(await settle()).toMatchObject({ chargedMinor: 20 });
    const ev = (await events(h, t.orgId, 'wallet.margin.override_saved'))[0];
    expect(ev.payload).toMatchObject({
      note: 'Enterprise deal: pay Meta cost x2 (contract 7781)',
      saved: 1,
    });
    const sec = await h.owner.query(
      `SELECT payload FROM security_events WHERE subject_org_id = $1 AND event = 'platform.wallet.margin_override'`,
      [t.orgId],
    );
    expect(sec.rows).toHaveLength(1);
    const listed = marginsResponseSchema.parse(
      (await ops('get', `/workspaces/${tUuid}/margins`)).body,
    );
    expect(listed.scope).toEqual({ type: 'workspace', workspaceId: tUuid });
    expect(listed.data[0]).toMatchObject({
      marginBps: 10_000,
      priceMinor: 20,
      metaCost: '0.10',
      setBy: expect.stringContaining('Ops'),
    });
  });

  it('a -100% override makes the country free for that workspace only', async () => {
    await ops('put', `/workspaces/${tUuid}/margins`).send({
      rows: [{ countryCode: 'LI', category: 'marketing', margin: '-100' }],
      note: 'Pilot customer, free for 30 days',
    });
    const before = await balanceMinor(h, t.orgId);
    expect(await settle()).toMatchObject({ status: 'free', reason: 'rate_is_zero' });
    expect(await balanceMinor(h, t.orgId)).toBe(before);
  });

  it('removing the override returns the workspace to its plan margin', async () => {
    const listed = marginsResponseSchema.parse(
      (await ops('get', `/workspaces/${tUuid}/margins`)).body,
    );
    const r = await ops('put', `/workspaces/${tUuid}/margins`).send({
      removeIds: [listed.data[0]!.id],
      note: 'Pilot over, back to plan',
    });
    expect(r.body).toMatchObject({ saved: 0, removed: 1 });
    const p = pricePreviewSchema.parse(
      (await ops('get', `/pricing/preview?workspaceId=${tUuid}&country=LI&category=marketing`))
        .body,
    );
    expect(p).toMatchObject({ marginSource: 'plan', priceMinor: 15 });
  });

  it('keeps typed prices where Meta cost is unknown, and one workspace cannot see another workspace override', async () => {
    const other = await newTenant(h, 'mg2');
    const ou = (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [other.orgId]))
      .rows[0].uuid;
    const preview = async () =>
      pricePreviewSchema.parse(
        (await ops('get', `/pricing/preview?workspaceId=${ou}&country=BR&category=utility`)).body,
      );
    // With Meta's official card stored, Brazil utility has a cost, so the margin applies to it.
    expect((await preview()).basis).toBe('margin');
    // With no card for the currency (and no cost on the grid) the cost is unknown and the typed price stands.
    const cards = h.app.get(MetaRateCardService, { strict: false });
    await h.owner.query(
      `CREATE TEMP TABLE usd_card_backup AS SELECT * FROM meta_rate_cards WHERE currency = 'USD'`,
    );
    try {
      await h.owner.query(`DELETE FROM meta_rate_cards WHERE currency = 'USD'`);
      cards.invalidate();
      expect((await preview()).basis).toBe('fixed');
    } finally {
      await h.owner.query(
        `INSERT INTO meta_rate_cards SELECT * FROM usd_card_backup ON CONFLICT DO NOTHING`,
      );
      await h.owner.query(`DROP TABLE usd_card_backup`);
      cards.invalidate();
    }
    const mine = marginsResponseSchema.parse((await ops('get', `/workspaces/${ou}/margins`)).body);
    expect(mine.data).toEqual([]);
  });

  it('shows the customer the margin-based base prices in the price panel', async () => {
    const r = await h.api.as(t.admin).get('/v2/wallet/pricing?country=LI');
    expect(r.status).toBe(200);
    expect(
      r.body.categories.find((c: { category: string }) => c.category === 'marketing').priceMinor,
    ).toBe(15);
  });

  it('removes a plan margin row and records it', async () => {
    const plan = (await h.owner.query(`SELECT plan FROM organizations WHERE id = $1`, [t.orgId]))
      .rows[0].plan as string;
    const row = marginsResponseSchema.parse((await ops('get', `/margins?plan=${plan}`)).body)
      .data[0]!;
    expect((await ops('delete', `/margins/${row.id}`)).body).toEqual({ deleted: true });
    expect((await ops('delete', `/margins/${row.id}`)).status).toBe(404);
    expect((await ops('get', '/margins?plan=no-such-plan')).status).toBe(404);
  });
});
