import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  balanceMinor,
  charges,
  cleanWallet,
  fixedPricing,
  fund,
  newTenant,
  services,
  setPlan,
  setReseller,
  startBspHarness,
  type BspHarness,
  type Tenant,
} from './support';

/**
 * A send to a Meta Cloud API group is billed once per member (docs/specs/waba-groups-management.md D8), on the real schema: the launch
 * gate is asked for `participant_count` recipients, so a wallet that covers one message does not cover a group of eight; and each
 * billable member that reaches delivered or read is charged once, keyed `<wamid>:<member id>`. There is no hold: money moves only on
 * delivery, so "settle" is the per-member charge and a member Meta marks free is never charged.
 * Prices come from the seeded starter card (fixedPricing): a recipient with no number is priced at 1.00.
 * NOT run against real Meta: the statuses here are what the spec and the reference say Meta sends.
 */
let h: BspHarness;
let startedAt: Date;
let n = 0;
const wamid = () => `wamid.GRP.${Date.now()}.${n++}`;

async function reseller(label: string): Promise<Tenant> {
  const t = await newTenant(h, label);
  await setReseller(h, t.orgId, true);
  return t;
}

const launch = (orgId: number, members: number) =>
  services(h).gate.assertCanLaunch({
    orgId,
    source: 'group_message',
    recipients: Math.max(1, members),
  });

const settleMember = (orgId: number, id: string, member: string, category: string | null = null) =>
  services(h).billing.settleDelivered({
    orgId,
    provider: 'waba',
    providerMessageId: `${id}:${member}`.slice(0, 191),
    recipient: /^\+?\d{6,20}$/.test(member) ? member : null,
    category,
    source: 'inbox',
  });

beforeAll(async () => {
  startedAt = new Date();
  h = await startBspHarness();
  await fixedPricing(h);
}, 120_000);

afterAll(async () => {
  await cleanWallet(h, startedAt);
  await h.stop();
});

describe('the pre-send wallet check against the group size (D8)', () => {
  it('refuses a group of 8 on a wallet that covers one message, and lets it through once the wallet covers all 8', async () => {
    const t = await reseller('gw1');
    await fund(h, t.orgId, 300); // 3.00: one message at 1.00 fits, eight do not
    await expect(launch(t.orgId, 1)).resolves.toBeUndefined();
    await expect(launch(t.orgId, 8)).rejects.toMatchObject({ code: ERROR_CODES.WALLET_EMPTY });
    await fund(h, t.orgId, 600); // 9.00 in total, 8.00 needed
    await expect(launch(t.orgId, 8)).resolves.toBeUndefined();
  });

  it('refuses an empty wallet whatever the group size, and moves no money on a refusal', async () => {
    const t = await reseller('gw2');
    await expect(launch(t.orgId, 3)).rejects.toMatchObject({
      code: ERROR_CODES.WALLET_EMPTY,
      message: 'Your message wallet is empty. Top up to start sending.',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(0);
    expect(await charges(h, t.orgId)).toHaveLength(0);
  });

  it('prices a group the size is not known for (0 members) as one recipient', async () => {
    const t = await reseller('gw3');
    await fund(h, t.orgId, 100);
    await expect(launch(t.orgId, 0)).resolves.toBeUndefined();
  });

  it('never blocks a platform-owned workspace', async () => {
    const t = await newTenant(h, 'gw4');
    await setPlan(h, t.orgId, { platformOwned: true });
    await expect(launch(t.orgId, 500)).resolves.toBeUndefined();
  });
});

describe('the composer quote (never throws)', () => {
  it('gives the estimate for every member in the billing currency and says whether the wallet covers it', async () => {
    const t = await reseller('gq1');
    await fund(h, t.orgId, 300);
    const short = await services(h).gate.quote({
      orgId: t.orgId,
      source: 'group_message',
      recipients: 8,
    });
    expect(short).toEqual({ estimateMinor: 800, currency: 'USD', covered: false });
    const fits = await services(h).gate.quote({
      orgId: t.orgId,
      source: 'group_message',
      recipients: 3,
    });
    expect(fits).toEqual({ estimateMinor: 300, currency: 'USD', covered: true });
  });

  it('answers null for an unknown workspace instead of throwing', async () => {
    await expect(
      services(h).gate.quote({ orgId: 999_999_999, source: 'group_message', recipients: 5 }),
    ).resolves.toBeNull();
  });
});

describe('the per-member charge on delivery', () => {
  it('charges each billable member once: a repeated status, or a read after the delivery, moves no more money', async () => {
    const t = await reseller('gs1');
    await fund(h, t.orgId, 1000);
    const id = wamid();
    const members = ['919900000001', '919900000002', '919900000003'];
    for (const m of members) {
      expect(await settleMember(t.orgId, id, m)).toMatchObject({ status: 'charged' });
    }
    // Meta retries a webhook, then reports "read" for the same member: the same key, so no second charge.
    expect(await settleMember(t.orgId, id, members[0]!)).toMatchObject({ status: 'replayed' });
    expect(await settleMember(t.orgId, id, members[1]!)).toMatchObject({ status: 'replayed' });
    const rows = await charges(h, t.orgId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.wamid).sort()).toEqual(members.map((m) => `${id}:${m}`).sort());
    expect(await balanceMinor(h, t.orgId)).toBe(1000 - 3 * 100);
  });

  it('keys a member without a phone number (a BSUID) too, and passes no recipient country', async () => {
    const t = await reseller('gs2');
    await fund(h, t.orgId, 500);
    const id = wamid();
    expect(await settleMember(t.orgId, id, 'US.13491208655302741918')).toMatchObject({
      status: 'charged',
    });
    expect(await balanceMinor(h, t.orgId)).toBe(400);
  });

  it('two messages to the same member are two charges (the key includes the message)', async () => {
    const t = await reseller('gs3');
    await fund(h, t.orgId, 500);
    await settleMember(t.orgId, wamid(), '919900000009');
    await settleMember(t.orgId, wamid(), '919900000009');
    expect(await charges(h, t.orgId)).toHaveLength(2);
    expect(await balanceMinor(h, t.orgId)).toBe(300);
  });

  it('a failed member refunds only that member', async () => {
    const t = await reseller('gs4');
    await fund(h, t.orgId, 500);
    const id = wamid();
    await settleMember(t.orgId, id, '919900000001');
    await settleMember(t.orgId, id, '919900000002');
    const refund = await services(h).billing.settleFailed(t.orgId, `${id}:919900000002`);
    expect(refund.refunded).toBe(true);
    expect(await balanceMinor(h, t.orgId)).toBe(400);
  });
});

describe('workspace isolation', () => {
  it("another workspace cannot read a workspace's group charges, and its own wallet is untouched", async () => {
    const a = await reseller('gi1');
    const b = await reseller('gi2');
    await fund(h, a.orgId, 500);
    await fund(h, b.orgId, 500);
    const id = wamid();
    await settleMember(a.orgId, id, '919900000001');
    const key = `${id}:919900000001`;
    const seenByB = await services(h).db.txAs({ orgId: b.orgId, userId: null }, (tx) =>
      tx.execute(sql`SELECT wamid FROM usage_charges WHERE wamid = ${key}`),
    );
    expect(seenByB.rows).toHaveLength(0);
    const seenByA = await services(h).db.txAs({ orgId: a.orgId, userId: null }, (tx) =>
      tx.execute(sql`SELECT wamid FROM usage_charges WHERE wamid = ${key}`),
    );
    expect(seenByA.rows).toHaveLength(1);
    expect(await balanceMinor(h, b.orgId)).toBe(500);
  });
});
