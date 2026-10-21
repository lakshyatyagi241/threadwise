import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  PLAN_FEATURE_DEFS,
  PLAN_PRODUCT_LINES,
  PLAN_UNLIMITED_FROM,
  isUnlimitedFor,
  planFeatureLine,
  planFeaturesOfLine,
  storedFeature,
  storedLimit,
} from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  mergeFeature,
  mergeLimit,
} from '../../../src/modules/addons-extension-registry/entitlement-merge';
import {
  packGrants,
  resolveFeature,
  resolveLimit,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import { TeamsPlanService } from '../../../src/modules/workspaces-teams-tenancy/teams-plan.service';

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

describe('product line metadata (BL-383)', () => {
  it('every plan feature key has a product line, and only the three known lines', () => {
    for (const d of PLAN_FEATURE_DEFS) {
      expect(PLAN_PRODUCT_LINES, d.key).toContain(d.productLine);
      expect(planFeatureLine(d.key)).toBe(d.productLine);
    }
    const all = PLAN_PRODUCT_LINES.flatMap((l) => planFeaturesOfLine(l));
    expect(all.sort()).toEqual(PLAN_FEATURE_DEFS.map((d) => d.key).sort());
  });

  it('puts the conversation side on chat and the sales side on crm', () => {
    for (const k of ['inbox_routing', 'team_chat', 'calling', 'sms', 'email_channel'] as const)
      expect(planFeatureLine(k), k).toBe('chat');
    for (const k of ['sales_pipeline', 'invoicing', 'record_assignment', 'lead_scoring'] as const)
      expect(planFeatureLine(k), k).toBe('crm');
    for (const k of ['automation', 'analytics', 'team_hierarchy', 'custom_roles'] as const)
      expect(planFeatureLine(k), k).toBe('platform');
  });
});

describe('team_hierarchy and custom_roles default to on, so no plan changes', () => {
  it('a plan row that predates them has both', () => {
    expect(storedFeature({}, 'team_hierarchy')).toBe(true);
    expect(storedFeature({}, 'custom_roles')).toBe(true);
    expect(resolveFeature(ent({ planFeatures: {} }), 'custom_roles')).toBe(true);
  });
  it('an operator can switch them off per plan, and an override still wins', () => {
    const off = ent({ planFeatures: { team_hierarchy: false, custom_roles: false } });
    expect(resolveFeature(off, 'team_hierarchy')).toBe(false);
    expect(resolveFeature(off, 'custom_roles')).toBe(false);
    expect(
      resolveFeature({ ...off, overrides: { features: { custom_roles: true } } }, 'custom_roles'),
    ).toBe(true);
  });
});

describe('the teams cap: 0 is solo, a missing value is unlimited', () => {
  const unl = (e: Entitlements) => isUnlimitedFor('teams', resolveLimit(e, 'teams'));

  it('reads a row that predates the key as unlimited', () => {
    expect(storedLimit({}, 'teams')).toBe(PLAN_UNLIMITED_FROM);
    expect(unl(ent())).toBe(true);
    expect(unl(ent({ planKnown: false }))).toBe(true);
    expect(unl(ent({ platformOwned: true }))).toBe(true);
  });
  it('keeps a stored 0 as solo and a number as the cap, and the other caps keep 0 = unlimited', () => {
    expect(resolveLimit(ent({ planLimits: { teams: 0 } }), 'teams')).toBe(0);
    expect(resolveLimit(ent({ planLimits: { teams: 5 } }), 'teams')).toBe(5);
    expect(resolveLimit(ent({ planLimits: { pipelines: 0 } }), 'pipelines')).toBe(0);
    expect(isUnlimitedFor('pipelines', 0)).toBe(true);
    expect(isUnlimitedFor('teams', 0)).toBe(false);
  });
  it('lets an override set solo (0), a number, or unlimited (-1)', () => {
    const base = ent({ planLimits: { teams: 5 } });
    expect(resolveLimit({ ...base, overrides: { limits: { teams: 0 } } }, 'teams')).toBe(0);
    expect(resolveLimit({ ...base, overrides: { limits: { teams: 9 } } }, 'teams')).toBe(9);
    expect(unl({ ...base, overrides: { limits: { teams: -1 } } })).toBe(true);
  });
  it('a pack raises a solo plan, unlimited absorbs, and -1 from a pack is unlimited', () => {
    const solo = ent({ planLimits: { teams: 0 }, packLimits: { teams: 10 } });
    expect(resolveLimit(solo, 'teams')).toBe(10);
    expect(
      resolveLimit(ent({ planLimits: { teams: 3 }, packLimits: { teams: 10 } }), 'teams'),
    ).toBe(13);
    expect(unl(ent({ planLimits: {}, packLimits: { teams: 10 } }))).toBe(true);
    expect(unl(ent({ planLimits: { teams: 0 }, packLimits: { teams: -1 } }))).toBe(true);
    // an override still beats the pack
    expect(resolveLimit({ ...solo, overrides: { limits: { teams: 2 } } }, 'teams')).toBe(2);
  });
  it('the add-on registry resolver agrees', () => {
    const plan = {
      platformOwned: false,
      planKnown: true,
      overrides: {},
      planFeatures: {},
      planLimits: { teams: 0 },
    };
    const grant = (n: number) => ({ features: [], limits: { teams: n } });
    expect(mergeLimit(plan, 'teams', [])).toBe(0);
    expect(mergeLimit(plan, 'teams', [grant(10)])).toBe(10);
    expect(isUnlimitedFor('teams', mergeLimit(plan, 'teams', [grant(-1)]))).toBe(true);
    expect(isUnlimitedFor('teams', mergeLimit({ ...plan, planLimits: {} }, 'teams', []))).toBe(
      true,
    );
    expect(
      mergeFeature({ ...plan, planFeatures: { custom_roles: false } }, 'custom_roles', [
        { features: ['custom_roles'], limits: {} },
      ]),
    ).toBe(true);
  });
});

describe('plain add-on packs grant only the packaging keys', () => {
  it('reads the two features and the teams number, nothing else', () => {
    const g = packGrants([
      {
        features: { team_hierarchy: true, automation: true },
        limits: { teams: 10, contacts: 500 },
      },
      { features: { custom_roles: true }, limits: { teams: 5 } },
    ]);
    expect(g.features.sort()).toEqual(['custom_roles', 'team_hierarchy']);
    expect(g.limits).toEqual({ teams: 15 });
    expect(
      packGrants([
        { features: {}, limits: { teams: -1 } },
        { features: {}, limits: { teams: 4 } },
      ]).limits,
    ).toEqual({ teams: -1 });
    expect(packGrants([{ features: { automation: true }, limits: { contacts: 5 } }])).toEqual({
      features: [],
      limits: {},
    });
  });
});

describe('TeamsPlanService', () => {
  const tx = (used: number) => ({ execute: vi.fn(async () => ({ rows: [{ n: used }] })) });
  const svc = (cap: number, feature = true) =>
    new TeamsPlanService({
      limit: vi.fn(async () => cap),
      featureEnabled: vi.fn(async () => feature),
      assertFeature: vi.fn(async () => {
        if (!feature)
          throw new AppError(ERROR_CODES.PLAN_FEATURE_LOCKED, 'x', HttpStatus.UNPROCESSABLE_ENTITY);
      }),
    } as never);
  const run = (s: TeamsPlanService, used: number) =>
    s.assertCanCreate(tx(used) as never, 1).then(
      () => null,
      (e: unknown) => e as AppError,
    );

  it('unlimited skips the count', async () => {
    const t = tx(999);
    await expect(svc(PLAN_UNLIMITED_FROM).assertCanCreate(t as never, 1)).resolves.toBeUndefined();
    expect(t.execute).not.toHaveBeenCalled();
  });
  it('solo refuses with PLAN_TEAMS_NOT_INCLUDED (422) and an upgrade link', async () => {
    const err = await run(svc(0), 0);
    expect(err).toBeInstanceOf(AppError);
    expect(err!.code).toBe(ERROR_CODES.PLAN_TEAMS_NOT_INCLUDED);
    expect(err!.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(err!.details).toContainEqual({ path: 'reason', message: 'teams_not_included' });
  });
  it('a full cap refuses with PLAN_LIMIT_REACHED naming the teams limit; the last place passes', async () => {
    const err = await run(svc(3), 3);
    expect(err!.code).toBe(ERROR_CODES.PLAN_LIMIT_REACHED);
    expect(err!.details).toContainEqual({ path: 'limit', message: 'teams' });
    expect(err!.details).toContainEqual({ path: 'limitValue', message: '3' });
    expect(await run(svc(3), 2)).toBeNull();
  });
  it('the hierarchy gate is PLAN_FEATURE_LOCKED when the feature is off', async () => {
    await expect(svc(0, true).assertHierarchy(1)).resolves.toBeUndefined();
    await expect(svc(0, false).assertHierarchy(1)).rejects.toMatchObject({
      code: ERROR_CODES.PLAN_FEATURE_LOCKED,
    });
    expect(await svc(0, false).hierarchyEnabled(1)).toBe(false);
  });
});
