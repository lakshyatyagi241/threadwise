import { PlatformSettingsService } from '../../../src/modules/auth';
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
