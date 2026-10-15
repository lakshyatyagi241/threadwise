import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import {
  grantedByPack,
  splitAppPacks,
  type AppPack,
} from '../../../src/modules/plans-subscriptions-trials/app-grants';
import {
  featureLocked,
  resolveFeature,
  type Entitlements,
} from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';

const forms = (install: AppPack['install']): AppPack => ({
  slug: 'forms',
  features: { mkt_forms: true, form_builder: true },
  install,
});

describe('an app add-on grants its plan features only while the app is installed and running', () => {
  it('not installed: only the app entitlement key counts, so the workspace can still install it', () => {
    expect(grantedByPack(forms(null))).toEqual(['mkt_forms']);
  });

  it('installed and active: the plan features count too', () => {
    expect(grantedByPack(forms('active')).sort()).toEqual(['form_builder', 'mkt_forms']);
  });

  it.each(['disabled', 'killed'] as const)(
    '%s: runtime stays off, the entitlement key stays',
    (s) => {
      expect(grantedByPack(forms(s))).toEqual(['mkt_forms']);
    },
  );

  it('ignores features that are not true', () => {
    expect(
      grantedByPack({ slug: 'x', features: { a: false, b: 'yes' }, install: 'active' }),
    ).toEqual([]);
    expect(grantedByPack({ slug: 'x', features: null, install: 'active' })).toEqual([]);
  });

  it('reports what is withheld, and whether the app is installed (paused) or not', () => {
    expect(splitAppPacks([forms(null)])).toEqual({
      granted: { mkt_forms: true },
      withheld: { form_builder: { slug: 'forms', installed: false } },
    });
    expect(splitAppPacks([forms('disabled')]).withheld).toEqual({
      form_builder: { slug: 'forms', installed: true },
    });
    expect(splitAppPacks([forms('active')])).toEqual({
      granted: { mkt_forms: true, form_builder: true },
      withheld: {},
    });
  });

  it('a feature another running app grants is not withheld', () => {
    const other: AppPack = { slug: 'other', features: { form_builder: true }, install: 'active' };
    expect(splitAppPacks([forms(null), other]).withheld).toEqual({});
  });
});

const ent = (over: Partial<Entitlements>): Entitlements => ({
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
});

describe('the lock the API answers', () => {
  it('names the app and where to install it when the subscription is there but the app is not installed', () => {
    const e = ent({ appWithheld: { form_builder: { slug: 'forms', installed: false } } });
    expect(resolveFeature(e, 'form_builder')).toBe(false);
    const err = featureLocked(e, 'form_builder');
    expect(err.code).toBe(ERROR_CODES.PLAN_FEATURE_LOCKED);
    expect(err.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(JSON.stringify(err.details)).toContain('app_not_installed');
    expect(JSON.stringify(err.details)).toContain('/marketplace/app/forms');
  });

  it('says paused when the app is installed but switched off', () => {
    const e = ent({ appWithheld: { form_builder: { slug: 'forms', installed: true } } });
    expect(JSON.stringify(featureLocked(e, 'form_builder').details)).toContain('app_paused');
  });

  it('is the plain upgrade lock when no app is involved', () => {
    const err = featureLocked(ent({}), 'form_builder');
    expect(JSON.stringify(err.details)).toContain('feature_disabled');
    expect(JSON.stringify(err.details)).toContain('upgradeUrl');
  });

  it('a plan that carries the feature keeps it on whatever the app state is', () => {
    const e = ent({
      planFeatures: { form_builder: true },
      appWithheld: { form_builder: { slug: 'forms', installed: false } },
    });
    expect(resolveFeature(e, 'form_builder')).toBe(true);
  });
});
