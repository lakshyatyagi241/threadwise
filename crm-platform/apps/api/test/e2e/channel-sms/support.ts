import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformSettingsService } from '../../../src/modules/auth';
import {
  BillingCurrencyService,
  WalletLedgerService,
} from '../../../src/modules/wallet-message-billing';
import {
  SMS_GATEWAY,
  type SmsCredentials,
  type SmsGateway,
  type SmsLookupResult,
  type SmsSendResult,
  type SmsVerifyResult,
} from '../../../src/infra/providers/channel-sms/sms.port';
import type { Harness, Tenant } from '../contacts-attributes-tags/support';

/**
 * The SMS provider as a spec sees it: the real gateway object with its three calls replaced, so the real sender, service,
 * repository and webhook run and only the far end is fake. Each call is recorded.
 */
export interface FakeSms {
  verifyCalls: SmsCredentials[];
  sendCalls: Array<{ creds: SmsCredentials; to: string; body: string; callback?: string }>;
  lookupCalls: Array<{ creds: SmsCredentials; number: string }>;
  verify: SmsVerifyResult;
  /** What the next sends answer; the last entry repeats. A function answers per call. */
  send: SmsSendResult | ((n: number) => SmsSendResult);
  lookup: SmsLookupResult;
  reset(): void;
}

export function installFakeSms(h: Harness): FakeSms {
  const gateway = h.app.get<SmsGateway>(SMS_GATEWAY as never);
  const fake: FakeSms = {
    verifyCalls: [],
    sendCalls: [],
    lookupCalls: [],
    verify: { ok: true },
    send: (n) => ({ ok: true, messageId: `SM${String(n).padStart(4, '0')}`, segments: 1 }),
    lookup: {
      ok: true,
      digits: '',
      kind: 'mobile',
      carrier: 'Airtel',
      message: 'Mobile — can receive SMS. Carrier: Airtel.',
    },
    reset() {
      fake.verifyCalls.length = 0;
      fake.sendCalls.length = 0;
      fake.lookupCalls.length = 0;
      fake.verify = { ok: true };
      fake.send = (n) => ({ ok: true, messageId: `SM${String(n).padStart(4, '0')}`, segments: 1 });
    },
  };
  gateway.verify = (creds) => {
    fake.verifyCalls.push(creds);
    return Promise.resolve(fake.verify);
  };
  gateway.send = (creds, to, body, opts) => {
    fake.sendCalls.push({ creds, to, body, callback: opts?.statusCallbackUrl });
    const n = fake.sendCalls.length;
    return Promise.resolve(typeof fake.send === 'function' ? fake.send(n) : fake.send);
  };
  gateway.lookup = (creds, number) => {
    fake.lookupCalls.push({ creds, number });
    return Promise.resolve({ ...fake.lookup, digits: number.replace(/\D+/g, '') });
  };
  return fake;
}

/** The platform switch on, as an operator would turn it on. */
export async function switchSmsOn(h: Harness, on = true): Promise<void> {
  await h.app.get(PlatformSettingsService).set('sms_enabled', on, null);
}

/** The workspace's plan includes SMS (and optionally caps). Overrides are what the plan editor's per-workspace override writes. */
export async function planWithSms(
  h: Harness,
  t: Tenant,
  opts: { limits?: Record<string, number>; sms?: boolean } = {},
): Promise<void> {
  await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({ features: { sms: opts.sms ?? true }, limits: opts.limits ?? {} }),
  ]);
}

/**
 * Puts money in the workspace's wallet through the ledger, the way a paid top-up does, in the currency the workspace is billed in.
 * An SMS is paid for per segment (default 0.50), so a workspace that sends one needs a balance; hundredths.
 */
export async function fundWallet(h: Harness, t: Tenant, minor = 100_000): Promise<void> {
  const get = <T>(token: unknown) => h.app.get<T>(token as never, { strict: false });
  const db = get<DatabaseService>(DatabaseService);
  const ledger = get<WalletLedgerService>(WalletLedgerService);
  const billing = get<BillingCurrencyService>(BillingCurrencyService);
  await db.txAs({ orgId: t.orgId, userId: null }, async (tx) => {
    await ledger.post(tx, {
      orgId: t.orgId,
      unit: await billing.forOrg(tx, t.orgId),
      type: 'topup',
      direction: 'in',
      amountMinor: minor,
      idempotencyKey: `fund:${t.orgId}:${randomUUID()}`,
      source: 'topup.conversion',
      description: 'Wallet top-up',
    });
  });
}

/** The `usage.reported` events the workspace's sends wrote to the outbox, oldest first (the worker's billing consumer settles them). */
export async function usageEvents(h: Harness, t: Tenant) {
  const res = await h.owner.query(
    `SELECT aggregate_module, aggregate_id, payload FROM event_outbox
     WHERE org_id = $1 AND event_type = 'usage.reported' ORDER BY id`,
    [t.orgId],
  );
  return res.rows.map((r) => ({
    aggregateModule: r.aggregate_module as string,
    aggregateId: Number(r.aggregate_id),
    ...(r.payload as Record<string, unknown>),
  })) as Array<{
    aggregateModule: string;
    aggregateId: number;
    kind: string;
    usageId: string;
    status: string;
    units: number;
    recipient?: string | null;
    source?: string | null;
    provider?: string | null;
    subjectName?: string | null;
  }>;
}
