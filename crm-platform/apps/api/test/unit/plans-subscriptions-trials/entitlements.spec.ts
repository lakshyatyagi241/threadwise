import { HttpStatus, Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PLAN_CHIP_MAX,
  PLAN_CHIP_ORDER,
  PLAN_FEATURE_DEFS,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  PLAN_UPGRADE_PATH,
  storedFeature,
  storedLimit,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import {
  PlanEntitlementService,
  resolveFeature,
  resolveLimit,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import type { PlanRow } from '../../../src/modules/plans-subscriptions-trials/plan-row';

// The service logs a warning when an org is on a plan with no catalogue row; keep the test output readable.
beforeAll(() => Logger.overrideLogger(false));
afterAll(() => Logger.overrideLogger(['log', 'error', 'warn']));

/** The entitlements of an org on a known plan that grants nothing special. */
function ent(over: Partial<Entitlements> = {}): Entitlements {
  return {
    orgId: 1,
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
    visibleApps: { all: false, appIds: new Set() },
    appWithheld: {},
    ...over,
  };
}

describe('registry', () => {
  it('declares every key once and the chip order covers each feature exactly once', () => {
    expect(new Set(PLAN_FEATURE_KEYS).size).toBe(PLAN_FEATURE_KEYS.length);
    expect(new Set(PLAN_LIMIT_KEYS).size).toBe(PLAN_LIMIT_KEYS.length);
    expect([...PLAN_CHIP_ORDER].sort()).toEqual([...PLAN_FEATURE_KEYS].sort());
    expect(PLAN_CHIP_ORDER).toEqual([
      'analytics',
      'automation',
      'ai_assistants',
      'woocommerce',
      'shopify',
      'calling',
      'remove_branding',
      'sales_pipeline',
      'appointment_booking',
      'chatbot_widgets',
      'wa_storefront',
      'inbox_sla',
      'inbox_routing',
      'waba_calling',
      'inbox_kanban',
      'team_performance',
      'scheduled_messages',
      'whatsapp_warmer',
      'marketplace',
      'lead_sources',
      'team_chat',
      'public_api',
      'outbound_webhooks',
      'storefront_builder',
      'invoicing',
      'forms_and_links',
      'extra_channels',
      'form_builder',
      'waba_groups',
      'sms',
      'help_agent',
      'email_channel',
    ]);
    expect(PLAN_CHIP_MAX).toBe(3);
  });

  it('registers the deals gate and the pipelines cap, which the deals area reads from the plan JSON', () => {
    expect(PLAN_FEATURE_KEYS).toContain('sales_pipeline');
    expect(PLAN_LIMIT_KEYS).toContain('pipelines');
    // A plan row that predates the keys keeps the area it had: not locked, not capped.
    expect(PLAN_FEATURE_DEFS.find((d) => d.key === 'sales_pipeline')?.default).toBe(true);
    expect(resolveFeature(ent({ planFeatures: {} }), 'sales_pipeline')).toBe(true);
    expect(resolveLimit(ent({ planLimits: {} }), 'pipelines')).toBe(0);
    expect(resolveFeature(ent({ planFeatures: { sales_pipeline: false } }), 'sales_pipeline')).toBe(
      false,
    );
    expect(resolveLimit(ent({ planLimits: { pipelines: 3 } }), 'pipelines')).toBe(3);
    expect(
      resolveLimit(
        ent({ planLimits: { pipelines: 3 }, overrides: { limits: { pipelines: -1 } } }),
        'pipelines',
      ),
    ).toBe(0);
  });

  it('the branding feature is off unless a plan grants it', () => {
    expect(PLAN_FEATURE_DEFS.find((d) => d.key === 'remove_branding')?.default).toBe(false);
  });

  it('storedFeature: the stored boolean, else the registry default', () => {
    expect(storedFeature({ calling: true }, 'calling')).toBe(true);
    expect(storedFeature({ ai_assistants: false }, 'ai_assistants')).toBe(false);
    // missing key -> registry default
    expect(storedFeature({}, 'ai_assistants')).toBe(true);
    expect(storedFeature({}, 'calling')).toBe(false);
    expect(storedFeature(null, 'shopify')).toBe(true);
    expect(storedFeature('nope', 'automation')).toBe(false);
    // a non-boolean is not "enabled"
    expect(storedFeature({ calling: 'true' }, 'calling')).toBe(false);
    expect(storedFeature({ shopify: 0 }, 'shopify')).toBe(true);
  });

  it('storedLimit: a positive whole number, everything else is 0 (unlimited)', () => {
    expect(storedLimit({ devices: 5 }, 'devices')).toBe(5);
    expect(storedLimit({ devices: 0 }, 'devices')).toBe(0);
    expect(storedLimit({ devices: -3 }, 'devices')).toBe(0);
    expect(storedLimit({ devices: 2.5 }, 'devices')).toBe(0);
    expect(storedLimit({ devices: '5' }, 'devices')).toBe(0);
    expect(storedLimit({}, 'devices')).toBe(0);
    expect(storedLimit(null, 'devices')).toBe(0);
    expect(storedLimit([], 'devices')).toBe(0);
  });
});

describe('resolveFeature', () => {
  it('a platform-owned organization has every feature, whatever the plan or an override says', () => {
    for (const key of PLAN_FEATURE_KEYS) {
      expect(
        resolveFeature(
          ent({
            platformOwned: true,
            planFeatures: Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, false])),
            overrides: { features: { [key]: false } },
          }),
          key,
        ),
        key,
      ).toBe(true);
    }
  });

  it('follows the plan when there is no override', () => {
    const e = ent({ planFeatures: { calling: true, analytics: false } });
    expect(resolveFeature(e, 'calling')).toBe(true);
    expect(resolveFeature(e, 'analytics')).toBe(false);
  });

  it('an override beats the plan in both directions', () => {
    const e = ent({
      planFeatures: { calling: false, analytics: true },
      overrides: { features: { calling: true, analytics: false } },
    });
    expect(resolveFeature(e, 'calling')).toBe(true);
    expect(resolveFeature(e, 'analytics')).toBe(false);
  });

  it('an override of another key does not leak onto this one', () => {
    const e = ent({
      planFeatures: { calling: false },
      overrides: { features: { analytics: true } },
    });
    expect(resolveFeature(e, 'calling')).toBe(false);
  });

  it('ignores an override that is not a boolean', () => {
    for (const bad of ['true', 1, 0, null, {}, []]) {
      const e = ent({
        planFeatures: { remove_branding: false },
        overrides: { features: { remove_branding: bad } },
      });
      expect(resolveFeature(e, 'remove_branding'), JSON.stringify(bad)).toBe(false);
    }
  });

  it('a plan row that predates a key grants what the registry default says', () => {
    const e = ent({ planFeatures: {} });
    for (const def of PLAN_FEATURE_DEFS) {
      expect(resolveFeature(e, def.key), def.key).toBe(def.default);
    }
    expect(resolveFeature(ent({ planFeatures: { calling: 'yes' } }), 'calling')).toBe(false);
  });

  it('an organization whose plan has no catalogue row has every feature enabled', () => {
    const e = ent({ planKnown: false, planName: null, planFeatures: {} });
    for (const key of PLAN_FEATURE_KEYS) expect(resolveFeature(e, key), key).toBe(true);
  });

  it('an explicit override still applies to an unknown plan', () => {
    const e = ent({ planKnown: false, overrides: { features: { remove_branding: false } } });
    expect(resolveFeature(e, 'remove_branding')).toBe(false);
    expect(resolveFeature(e, 'calling')).toBe(true);
  });
});

describe('resolveLimit', () => {
  it('a platform-owned organization is never limited', () => {
    const e = ent({
      platformOwned: true,
      planLimits: { devices: 1 },
      overrides: { limits: { devices: 1 } },
    });
    expect(resolveLimit(e, 'devices')).toBe(0);
  });

  it('follows the plan: a positive cap, 0 for unlimited', () => {
    const e = ent({ planLimits: { devices: 5, users: 0 } });
    expect(resolveLimit(e, 'devices')).toBe(5);
    expect(resolveLimit(e, 'users')).toBe(0);
  });

  it('a missing, negative, fractional or non-numeric plan value means unlimited', () => {
    const e = ent({ planLimits: { devices: -2, users: 1.5, contacts: '10' } });
    expect(resolveLimit(e, 'devices')).toBe(0);
    expect(resolveLimit(e, 'users')).toBe(0);
    expect(resolveLimit(e, 'contacts')).toBe(0);
    expect(resolveLimit(e, 'tags')).toBe(0);
  });

  it('a positive override beats the plan, whether it is tighter or looser', () => {
    const e = ent({
      planLimits: { devices: 5, users: 5 },
      overrides: { limits: { devices: 50, users: 2 } },
    });
    expect(resolveLimit(e, 'devices')).toBe(50);
    expect(resolveLimit(e, 'users')).toBe(2);
  });

  it('an override of -1 or 0 means unlimited and beats a capped plan', () => {
    const e = ent({
      planLimits: { devices: 5, users: 5 },
      overrides: { limits: { devices: -1, users: 0 } },
    });
    expect(resolveLimit(e, 'devices')).toBe(0);
    expect(resolveLimit(e, 'users')).toBe(0);
  });

  it('ignores an override that is not a whole number', () => {
    for (const bad of [2.5, '7', null, true, {}]) {
      const e = ent({ planLimits: { devices: 5 }, overrides: { limits: { devices: bad } } });
      expect(resolveLimit(e, 'devices'), JSON.stringify(bad)).toBe(5);
    }
  });

  it('an organization whose plan has no catalogue row has every limit at 0 (unlimited)', () => {
    const e = ent({ planKnown: false, planLimits: {} });
    for (const key of PLAN_LIMIT_KEYS) expect(resolveLimit(e, key), key).toBe(0);
  });

  it('an override still applies to an unknown plan', () => {
    const e = ent({ planKnown: false, overrides: { limits: { devices: 7 } } });
    expect(resolveLimit(e, 'devices')).toBe(7);
    expect(resolveLimit(e, 'users')).toBe(0);
  });
});

// --- the service, over a fake transaction -----------------------------------------------------------------------------

interface EntRow {
  plan_slug: string;
  trial_ends_at: string | null;
  plan_ends_at: string | null;
  billing_cycle: 'trial' | 'monthly' | 'yearly' | null;
  overrides: Record<string, unknown> | null;
  platform_owned: boolean | null;
  plan_name: string | null;
  plan_limits: Record<string, unknown> | null;
  plan_features: Record<string, unknown> | null;
  plan_found: boolean;
}

const entRow = (over: Partial<EntRow> = {}): EntRow => ({
  plan_slug: 'pro',
  trial_ends_at: null,
  plan_ends_at: null,
  billing_cycle: 'monthly',
  overrides: {},
  platform_owned: false,
  plan_name: 'Pro',
  plan_limits: {},
  plan_features: {},
  plan_found: true,
  ...over,
});

/** A DatabaseService whose every transaction answers with the same rows. */
function fakeDb(rows: unknown[]): DatabaseService {
  const tx = { execute: async () => ({ rows }) };
  return {
    txAs: async (_tenant: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as DatabaseService;
}

const serviceFor = (row: EntRow | undefined) => {
  const db = fakeDb(row ? [row] : []);
  return new PlanEntitlementService(db, new PlanCatalogService(db), new PlanStore(db));
};

async function thrown(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (err) {
    return err as AppError;
  }
  throw new Error('expected the call to throw');
}

describe('PlanEntitlementService.forOrg', () => {
  it('is null for an organization that does not exist, and grants nothing to it', async () => {
    const svc = serviceFor(undefined);
    expect(await svc.forOrg(99)).toBeNull();
    expect(await svc.featureEnabled(99, 'remove_branding')).toBe(false);
    expect(await svc.limit(99, 'devices')).toBe(0);
  });

  it('maps the joined row: dates become Dates, and a missing state row takes the defaults', async () => {
    const svc = serviceFor(
      entRow({
        trial_ends_at: '2026-10-15T10:00:00.000Z',
        plan_ends_at: '2027-01-01T00:00:00.000Z',
        billing_cycle: 'trial',
        overrides: { features: { calling: true } },
        platform_owned: true,
        plan_limits: { devices: 3 },
        plan_features: { calling: false },
      }),
    );
    const e = await svc.forOrg(1);
    expect(e).toMatchObject({
      orgId: 1,
      planSlug: 'pro',
      planKnown: true,
      planName: 'Pro',
      billingCycle: 'trial',
      platformOwned: true,
      overrides: { features: { calling: true } },
      planLimits: { devices: 3 },
      planFeatures: { calling: false },
    });
    expect(e?.trialEndsAt).toEqual(new Date('2026-10-15T10:00:00.000Z'));
    expect(e?.planEndsAt).toEqual(new Date('2027-01-01T00:00:00.000Z'));

    const bare = await serviceFor(
      entRow({
        billing_cycle: null,
        overrides: null,
        platform_owned: null,
        plan_limits: null,
        plan_features: null,
      }),
    ).forOrg(1);
    expect(bare).toMatchObject({
      trialEndsAt: null,
      planEndsAt: null,
      billingCycle: 'monthly',
      overrides: {},
      platformOwned: false,
      planLimits: {},
      planFeatures: {},
    });
  });

  it('marks a plan with no catalogue row unknown, and says so once per slug', async () => {
    const svc = serviceFor(entRow({ plan_slug: 'starter', plan_found: false, plan_name: null }));
    const warn = vi
      .spyOn((svc as unknown as { logger: Logger }).logger, 'warn')
      .mockImplementation(() => undefined);
    const first = await svc.forOrg(1);
    await svc.forOrg(1);
    await svc.forOrg(2);
    expect(first).toMatchObject({ planSlug: 'starter', planKnown: false, planName: null });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('answers the guards from the same resolution', async () => {
    const svc = serviceFor(
      entRow({
        plan_features: { remove_branding: true },
        plan_limits: { devices: 2 },
        overrides: { limits: { users: 9 } },
      }),
    );
    expect(await svc.featureEnabled(1, 'remove_branding')).toBe(true);
    expect(await svc.featureEnabled(1, 'calling')).toBe(false);
    expect(await svc.limit(1, 'devices')).toBe(2);
    expect(await svc.limit(1, 'users')).toBe(9);
    expect(await svc.limit(1, 'tags')).toBe(0);
  });
});

describe('PlanEntitlementService.assertFeature', () => {
  it('passes when the plan grants the feature', async () => {
    const svc = serviceFor(entRow({ plan_features: { remove_branding: true } }));
    await expect(svc.assertFeature(1, 'remove_branding')).resolves.toBeUndefined();
  });

  it('passes for an override, for a platform-owned org and for an unknown plan', async () => {
    const locked = { plan_features: { remove_branding: false } };
    await expect(
      serviceFor(
        entRow({ ...locked, overrides: { features: { remove_branding: true } } }),
      ).assertFeature(1, 'remove_branding'),
    ).resolves.toBeUndefined();
    await expect(
      serviceFor(entRow({ ...locked, platform_owned: true })).assertFeature(1, 'remove_branding'),
    ).resolves.toBeUndefined();
    await expect(
      serviceFor(entRow({ plan_found: false, plan_features: null })).assertFeature(
        1,
        'remove_branding',
      ),
    ).resolves.toBeUndefined();
  });

  it('throws the 422 PLAN_FEATURE_LOCKED problem with feature, reason and upgrade url', async () => {
    const svc = serviceFor(entRow({ plan_features: { remove_branding: false } }));
    const err = await thrown(svc.assertFeature(1, 'remove_branding'));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('PLAN_FEATURE_LOCKED');
    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err.details).toEqual([
      { path: 'feature', message: 'remove_branding' },
      { path: 'reason', message: 'feature_disabled' },
      { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
    ]);
  });

  it('uses the caller message when given and a sensible default otherwise', async () => {
    const svc = serviceFor(entRow({ plan_features: { calling: false } }));
    const custom = await thrown(svc.assertFeature(1, 'calling', 'No calling on this plan.'));
    expect((custom.getResponse() as { message: string }).message).toBe('No calling on this plan.');
    const dflt = await thrown(svc.assertFeature(1, 'calling'));
    expect((dflt.getResponse() as { message: string }).message).toMatch(/plan/i);
  });
});

describe('PlanEntitlementService.assertWithinLimit', () => {
  const withCap = (cap: number, extra: Partial<EntRow> = {}) =>
    serviceFor(entRow({ plan_limits: { devices: cap }, ...extra }));

  it('blocks row N+1: used below the cap passes, used at the cap throws', async () => {
    await expect(withCap(5).assertWithinLimit(1, 'devices', 0)).resolves.toBeUndefined();
    await expect(withCap(5).assertWithinLimit(1, 'devices', 4)).resolves.toBeUndefined();
    await expect(withCap(5).assertWithinLimit(1, 'devices', 5)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
    await expect(withCap(5).assertWithinLimit(1, 'devices', 9)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
  });

  it('0 is unlimited', async () => {
    await expect(withCap(0).assertWithinLimit(1, 'devices', 1_000_000)).resolves.toBeUndefined();
  });

  it('throws the 422 problem with the key, the numbers and the upgrade url', async () => {
    const err = await thrown(withCap(3).assertWithinLimit(1, 'devices', 3));
    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err.details).toEqual([
      { path: 'limit', message: 'devices' },
      { path: 'reason', message: 'limit_reached' },
      { path: 'used', message: '3' },
      { path: 'limitValue', message: '3' },
      { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
    ]);
    expect((err.getResponse() as { message: string }).message).toContain('limit of 3');
  });

  it('puts words, not underscores, in the message', async () => {
    const svc = serviceFor(entRow({ plan_limits: { monthly_messages: 10 } }));
    const err = await thrown(svc.assertWithinLimit(1, 'monthly_messages', 10));
    expect((err.getResponse() as { message: string }).message).toContain('monthly messages');
  });

  it('never throws for a platform-owned organization, an unlimited override or an unknown plan', async () => {
    await expect(
      withCap(1, { platform_owned: true }).assertWithinLimit(1, 'devices', 50),
    ).resolves.toBeUndefined();
    await expect(
      withCap(1, { overrides: { limits: { devices: -1 } } }).assertWithinLimit(1, 'devices', 50),
    ).resolves.toBeUndefined();
    await expect(
      serviceFor(entRow({ plan_found: false, plan_limits: null })).assertWithinLimit(
        1,
        'devices',
        50,
      ),
    ).resolves.toBeUndefined();
  });

  it('an override tightens a looser plan', async () => {
    const svc = withCap(100, { overrides: { limits: { devices: 2 } } });
    await expect(svc.assertWithinLimit(1, 'devices', 1)).resolves.toBeUndefined();
    await expect(svc.assertWithinLimit(1, 'devices', 2)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
    });
  });
});

// --- sign-up resolution ---------------------------------------------------------------------------------------------------

const planRow = (over: Partial<PlanRow> & { slug: string }): PlanRow => ({
  id: 1,
  uuid: '00000000-0000-4000-8000-00000000000a',
  name: over.slug,
  subtitle: null,
  detail: null,
  kind: 'plan',
  amount: '0.00',
  offer_amount: null,
  currency: 'USD',
  billing_unit: 'months',
  billing_duration: 1,
  is_free: true,
  is_lifetime: false,
  is_active: true,
  is_default: false,
  is_highlighted: false,
  is_custom_quote: false,
  sort_order: 0,
  cta_label: 'Get started',
  data_retention_days: 0,
  limits: {},
  features: {},
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('PlanEntitlementService.resolveInitialPlan', () => {
  const now = new Date('2026-10-01T10:00:00.000Z');
  const resolve = (rows: PlanRow[], registrationDefaultSlug: string | null, trialDays: number) => {
    const db = fakeDb([]);
    const svc = new PlanEntitlementService(db, new PlanCatalogService(db), new PlanStore(db));
    const tx = { execute: async () => ({ rows }) };
    return svc.resolveInitialPlan(tx as never, { registrationDefaultSlug, trialDays, now });
  };

  it('a free default with a trial length starts a trial', async () => {
    const got = await resolve([planRow({ slug: 'free', is_default: true })], null, 14);
    expect(got).toEqual({
      planSlug: 'free',
      step: 'flagged',
      billingCycle: 'trial',
      trialEndsAt: new Date('2026-10-15T10:00:00.000Z'),
    });
  });

  it('a free plan with 0 days has no trial', async () => {
    const got = await resolve([planRow({ slug: 'free' })], null, 0);
    expect(got).toEqual({
      planSlug: 'free',
      step: 'free',
      billingCycle: 'monthly',
      trialEndsAt: null,
    });
  });

  it('a paid registration default has no trial', async () => {
    const rows = [
      planRow({ slug: 'free' }),
      planRow({ slug: 'pro', amount: '29.00', is_free: false }),
    ];
    const got = await resolve(rows, 'pro', 14);
    expect(got).toEqual({
      planSlug: 'pro',
      step: 'setting',
      billingCycle: 'monthly',
      trialEndsAt: null,
    });
  });

  it('with no plans it is the literal starter, no trial', async () => {
    const got = await resolve([], null, 14);
    expect(got).toEqual({
      planSlug: 'starter',
      step: 'literal',
      billingCycle: 'monthly',
      trialEndsAt: null,
    });
  });

  it('an inactive registration plan falls through to the next step', async () => {
    const rows = [
      planRow({ slug: 'pro', amount: '29.00', is_free: false, is_active: false }),
      planRow({ slug: 'free' }),
    ];
    const got = await resolve(rows, 'pro', 14);
    expect(got).toMatchObject({ planSlug: 'free', step: 'free', billingCycle: 'trial' });
  });
});
