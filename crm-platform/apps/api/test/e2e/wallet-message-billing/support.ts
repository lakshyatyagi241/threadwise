import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  MessageBillingService,
  WalletGateService,
  WalletLedgerService,
} from '../../../src/modules/wallet-message-billing';
import {
  startBspHarness,
  newTenant,
  type BspHarness,
  type Tenant,
} from '../bsp-billing-engine/harness';

export { newTenant, startBspHarness, type BspHarness, type Tenant };

/** The platform settings the wallet tests write; removed by `cleanWallet`. */
export const WALLET_SETTING_KEYS = [
  'wallet.economics',
  'wallet.per_country_enabled',
  'billing.pay_per_message',
  // A suite that turns margin pricing on must not leave it on for the next one.
  'wallet.pricing_mode',
];

/** Typed handles on the services the engine tests drive directly. */
export function services(h: BspHarness) {
  const opts = { strict: false } as const;
  return {
    db: h.app.get(DatabaseService, opts),
    ledger: h.app.get(WalletLedgerService, opts),
    billing: h.app.get(MessageBillingService, opts),
    gate: h.app.get(WalletGateService, opts),
    settings: h.app.get(PlatformSettingsService, opts),
  };
}

/** Puts money in a workspace's wallet through the ledger, the way a paid top-up does. Hundredths. */
export async function fund(
  h: BspHarness,
  orgId: number,
  minor: number,
  key = `fund:${orgId}:${Math.random()}`,
) {
  const { db, ledger } = services(h);
  return db.txAs({ orgId, userId: null }, (tx) =>
    ledger.post(tx, {
      orgId,
      unit: 'USD',
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: key,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    }),
  );
}

export async function balanceMinor(h: BspHarness, orgId: number): Promise<number> {
  const r = await h.owner.query(
    `SELECT (balance * 100)::bigint AS minor FROM wallets WHERE org_id = $1`,
    [orgId],
  );
  return r.rows[0] ? Number(r.rows[0].minor) : 0;
}

export async function ledgerRows(h: BspHarness, orgId: number) {
  const r = await h.owner.query(
    `SELECT type, direction, (amount * 100)::bigint AS minor, (balance_after * 100)::bigint AS after, source, note, actor_label, idempotency_key
     FROM wallet_transactions WHERE org_id = $1 ORDER BY id`,
    [orgId],
  );
  return r.rows.map((x) => ({ ...x, minor: Number(x.minor), after: Number(x.after) }));
}

export async function charges(h: BspHarness, orgId: number) {
  const r = await h.owner.query(
    `SELECT wamid, status, credits, price_credits, shortfall_credits, free_reason, billing_mode, to_country, category, cost_minor, cost_micros
     FROM usage_charges WHERE org_id = $1 ORDER BY id`,
    [orgId],
  );
  return r.rows;
}

export async function events(h: BspHarness, orgId: number, event?: string) {
  const r = await h.owner.query(
    `SELECT event, severity, message, payload FROM wallet_events WHERE org_id = $1 ${event ? 'AND event = $2' : ''} ORDER BY id`,
    event ? [orgId, event] : [orgId],
  );
  return r.rows;
}

/** Makes a workspace pay per message (the reseller flag) or not. */
export async function setReseller(h: BspHarness, orgId: number, on: boolean) {
  await h.owner.query(
    `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, $2)
     ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = EXCLUDED.bill_to_platform_credit`,
    [orgId, on],
  );
}

/** Per-workspace plan limits (the override the entitlement resolver reads). */
export async function setPlan(
  h: BspHarness,
  orgId: number,
  p: { monthly?: number; planEndsAt?: string | null; platformOwned?: boolean },
) {
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, overrides, plan_ends_at, platform_owned)
     VALUES ($1, $2::jsonb, $3, $4)
     ON CONFLICT (org_id) DO UPDATE SET overrides = EXCLUDED.overrides, plan_ends_at = EXCLUDED.plan_ends_at, platform_owned = EXCLUDED.platform_owned`,
    [
      orgId,
      JSON.stringify({ limits: p.monthly === undefined ? {} : { monthly_messages: p.monthly } }),
      p.planEndsAt ?? null,
      p.platformOwned ?? false,
    ],
  );
}

/** Typed prices, the mode the engine tests assume: margin pricing off, whatever an earlier run left behind. */
export async function fixedPricing(h: BspHarness) {
  await h.owner.query(`DELETE FROM platform_settings WHERE key = 'wallet.pricing_mode'`);
  services(h).settings.invalidate();
}

/** Removes everything the wallet suites changed outside their own workspaces. */
export async function cleanWallet(h: BspHarness, startedAt: Date) {
  await h.owner.query(`DELETE FROM platform_settings WHERE key = ANY($1)`, [WALLET_SETTING_KEYS]);
  await h.owner.query(`DELETE FROM message_rates WHERE country_code IN ('QQ', 'ZZ', 'LI')`);
  await h.owner.query(`SELECT set_config('app.privileged', 'on', false)`);
  await h.owner.query(`DELETE FROM wallet_platform_log WHERE created_at >= $1`, [
    startedAt.toISOString(),
  ]);
  await h.owner.query(`SELECT set_config('app.privileged', 'off', false)`);
  services(h).settings.invalidate();
}
