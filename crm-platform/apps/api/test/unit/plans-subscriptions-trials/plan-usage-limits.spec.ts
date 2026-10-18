import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  PLAN_LIMIT_DEFS,
  PLAN_LIMIT_GROUPS,
  PLAN_LIMIT_KEYS,
  type PlanLimitKey,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import {
  PlanEntitlementService,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import { PlanUsageService } from '../../../src/modules/plans-subscriptions-trials/plan-usage.service';

function ent(over: Partial<Entitlements> = {}): Entitlements {
  return {
    orgId: 7,
    planSlug: 'pro',
    planKnown: true,
    planName: 'Pro',
    trialEndsAt: null,
    planEndsAt: null,
    billingCycle: 'monthly',
    platformOwned: false,
    overrides: {},
    planLimits: {},
    planFeatures: {},
    state: 'paid_active',
    visibleApps: { all: true, appIds: new Set<number>() },
    appWithheld: {},
    ...over,
  };
}

class FixedEntitlements extends PlanEntitlementService {
  constructor(private readonly fixed: Entitlements) {
    super(null as never, null as never, null as never);
  }
  override forOrg(): Promise<Entitlements | null> {
    return Promise.resolve(this.fixed);
  }
}

/** A database whose every count answers `used`, and which records how many counts were asked. */
function dbWith(used: number) {
  const execute = vi.fn(async () => ({ rows: [{ n: used }] }));
  const txAs = vi.fn(async (_ctx: unknown, fn: (tx: { execute: typeof execute }) => unknown) =>
    fn({ execute }),
  );
  return { db: { txAs } as unknown as DatabaseService, execute };
}

function service(e: Entitlements, used: number) {
  const { db, execute } = dbWith(used);
  return { usage: new PlanUsageService(db, new FixedEntitlements(e)), execute };
}

/** Keys that are not "live rows < cap" (see PlanUsageService.assertCanAdd) and so have their own enforcement. */
const OTHER_ENFORCEMENT: PlanLimitKey[] = [
  'monthly_messages',
  'total_campaigns',
  'broadcast_recipients',
  'ai_token_limit_monthly',
  // SMS sent this month: reserved atomically per message by the SMS sender (plan_usage, metric `sms_sent`).
  'sms_monthly',
  // Mails sent this month: the email campaign sender counts the month's outbound email messages before each run.
  'email_monthly',
];
// The request-rate cap is read by the API-key guard, it counts nothing in the database.
// `storage_gb` is bytes held, counted by the storage meter (modules/storage-quota). Its usage-panel entry arrives with enforcement (storage quota S2).
const NO_METER: PlanLimitKey[] = ['api_rate_limit_per_minute', 'storage_gb'];
const ROW_CAPPED = PLAN_LIMIT_KEYS.filter(
  (k) => !OTHER_ENFORCEMENT.includes(k) && !NO_METER.includes(k),
);

describe('plan limit registry', () => {
  it('puts every key in a declared group', () => {
    for (const d of PLAN_LIMIT_DEFS) expect(PLAN_LIMIT_GROUPS).toContain(d.group);
  });

  it('declares the sellable caps the plan editor must render', () => {
    for (const k of [
      'devices',
      'templates',
      'autoreplies',
      'saved_replies',
      'routing_rules',
      'scheduled_messages',
      'installed_apps',
      'lead_sources',
      'ai_token_limit_monthly',
      'api_keys',
      'chatbot_widgets',
      'catalog_products',
      'invoices_monthly',
      'recurring_invoices',
      'booking_types',
      'segments',
      'custom_fields',
      'webhooks',
      'team_chat_channels',
      'broadcast_recipients',
      'sla_policies',
    ] as PlanLimitKey[])
      expect(PLAN_LIMIT_KEYS, k).toContain(k);
  });

  it('has a usage meter for every cap that counts something', async () => {
    const { usage } = service(ent(), 0);
    const keys = (await usage.meters(ent())).map((m) => m.key);
    for (const k of PLAN_LIMIT_KEYS.filter((k) => !NO_METER.includes(k)))
      expect(keys, k).toContain(k);
  });
});

describe.each(ROW_CAPPED)('assertCanAdd(%s)', (key) => {
  it('refuses row N+1 with 422 PLAN_LIMIT_REACHED and the standard problem fields', async () => {
    const { usage } = service(ent({ planLimits: { [key]: 3 } }), 3);
    const err = await usage.assertCanAdd(7, key).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    const app = err as AppError;
    expect(app.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(app.code).toBe(ERROR_CODES.PLAN_LIMIT_REACHED);
    expect(app.details).toContainEqual({ path: 'limit', message: key });
  });

  it('lets the last place through', async () => {
    const { usage } = service(ent({ planLimits: { [key]: 3 } }), 2);
    await expect(usage.assertCanAdd(7, key)).resolves.toBeUndefined();
  });

  it('0 means unlimited and skips the count', async () => {
    const { usage, execute } = service(ent({ planLimits: { [key]: 0 } }), 999_999);
    await expect(usage.assertCanAdd(7, key)).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('a workspace override of -1 is unlimited even under a low plan cap', async () => {
    const { usage } = service(
      ent({ planLimits: { [key]: 1 }, overrides: { limits: { [key]: -1 } } }),
      50,
    );
    await expect(usage.assertCanAdd(7, key)).resolves.toBeUndefined();
  });

  it('a workspace override beats the plan cap in both directions', async () => {
    const tight = service(
      ent({ planLimits: { [key]: 100 }, overrides: { limits: { [key]: 2 } } }),
      2,
    );
    await expect(tight.usage.assertCanAdd(7, key)).rejects.toBeInstanceOf(AppError);
    const wide = service(
      ent({ planLimits: { [key]: 2 }, overrides: { limits: { [key]: 100 } } }),
      5,
    );
    await expect(wide.usage.assertCanAdd(7, key)).resolves.toBeUndefined();
  });
});

describe('assertCanAdd: keys with their own enforcement', () => {
  it.each(OTHER_ENFORCEMENT)('refuses %s on purpose', async (key) => {
    const { usage } = service(ent(), 0);
    await expect(usage.assertCanAdd(7, key)).rejects.toThrow(/does not apply/);
  });
});

describe('assertAudienceWithin (broadcast_recipients)', () => {
  it('refuses an audience bigger than the cap, says how big it was, and allows exactly the cap', async () => {
    const { usage } = service(ent({ planLimits: { broadcast_recipients: 500 } }), 0);
    await expect(usage.assertAudienceWithin(7, 500)).resolves.toBeUndefined();
    const err = (await usage.assertAudienceWithin(7, 501).catch((e: unknown) => e)) as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err.details).toContainEqual({ path: 'used', message: '501' });
    expect(err.details).toContainEqual({ path: 'limit', message: 'broadcast_recipients' });
  });

  it('0 is unlimited and an override of -1 is unlimited', async () => {
    const open = service(ent({ planLimits: { broadcast_recipients: 0 } }), 0);
    await expect(open.usage.assertAudienceWithin(7, 10_000_000)).resolves.toBeUndefined();
    const override = service(
      ent({
        planLimits: { broadcast_recipients: 10 },
        overrides: { limits: { broadcast_recipients: -1 } },
      }),
      0,
    );
    await expect(override.usage.assertAudienceWithin(7, 10_000_000)).resolves.toBeUndefined();
  });

  it('a platform-owned workspace is never capped', async () => {
    const { usage } = service(
      ent({ platformOwned: true, planLimits: { broadcast_recipients: 1 } }),
      0,
    );
    await expect(usage.assertAudienceWithin(7, 100)).resolves.toBeUndefined();
  });
});
