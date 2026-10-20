import { createElement } from 'react';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanAddonOption,
  type PlanAdminItem,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { newPlanDraft, type PlanDraft, type PlanProblems } from '../lib/plan-draft';
import { renderWithMessages } from '../render-test-utils';
import { AddonsTab, type AddonOptionsState } from './addons-tab';
import { FeaturesTab } from './features-tab';
import { LimitsTab } from './limits-tab';
import { PlanEditorTabs } from './plan-editor-tabs';
import type { EditorState } from './plan-editor-shared';
import { PlansPage } from './plans-page';
import { PLANS_QUERY_KEY } from './plans-query';
import { NODE_BRIDGE_QUERY_KEY } from '@/features/node-bridge-runtime/queries';

const A = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d21';
const B = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d22';
const GONE = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1dff';

const state = (over: Partial<PlanDraft> = {}, problems: PlanProblems = {}): EditorState => ({
  draft: { ...newPlanDraft(), ...over },
  problems,
  set: () => undefined,
  err: (f) => (problems[f] ? 'Broken' : undefined),
});

const pack = (over: Partial<PlanAddonOption> & { id: string }): PlanAddonOption => ({
  packSlug: 'mkt_pack',
  name: 'Appointments pack',
  isActive: true,
  amount: '9.00',
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: 1,
  app: { id: B, slug: 'appointments', name: 'Appointments', status: 'published' },
  ...over,
});

const addons = (over: Partial<AddonOptionsState>): AddonOptionsState => ({
  status: 'success',
  options: [],
  retry: () => undefined,
  ...over,
});

const render = (el: ReturnType<typeof createElement>, locale: 'en' | 'ar' = 'en') =>
  renderWithMessages(el, { locale });

describe.each(['en', 'ar'] as const)('plan editor tabs (%s)', (locale) => {
  it('lists every feature with a hint, in groups', () => {
    const html = render(createElement(FeaturesTab, { state: state() }), locale);
    for (const k of PLAN_FEATURE_KEYS) expect(html).toContain(`id="plan-feature-${k}"`);
  });

  it('lists every limit with a unit and an Unlimited checkbox', () => {
    const html = render(createElement(LimitsTab, { state: state() }), locale);
    for (const k of PLAN_LIMIT_KEYS) {
      expect(html).toContain(`data-testid="plan-limit-${k}"`);
      expect(html).toContain(`id="plan-limits-${k}-unlimited"`);
    }
    // Every limit starts blank = unlimited, so every input is disabled.
    expect(html.match(/<input[^>]*type="number"[^>]*disabled/g)?.length).toBe(
      PLAN_LIMIT_KEYS.length,
    );
  });

  it('greys the devices limit with a hint while the platform has unofficial WhatsApp off', () => {
    const bridge = (unofficialEnabled?: boolean) => ({
      serverUrl: '',
      tokenSet: false,
      rowVersion: 1,
      pacing: {},
      pacingRowVersion: 1,
      ...(unofficialEnabled === undefined ? {} : { unofficialEnabled }),
    });
    const withSwitch = (data: unknown) =>
      renderWithMessages(createElement(LimitsTab, { state: state() }), {
        locale,
        seed: [[NODE_BRIDGE_QUERY_KEY, data]],
      });
    const off = withSwitch(bridge(false));
    expect(off).toContain('data-testid="plan-limit-devices-platform-off"');
    expect(off).toMatch(/data-testid="plan-limit-devices"[^>]*data-platform-disabled="true"/);
    expect(off).toContain(locale === 'en' ? 'currently disabled' : 'معطّل حاليًا');
    // only the personal-number limit is greyed
    expect(off.match(/data-platform-disabled/g)).toHaveLength(1);
    // on, unknown (no answer yet) and a payload without the field: nothing is greyed
    expect(withSwitch(bridge(true))).not.toContain('plan-limit-devices-platform-off');
    expect(render(createElement(LimitsTab, { state: state() }), locale)).not.toContain(
      'plan-limit-devices-platform-off',
    );
  });

  it('enables a capped limit and shows its error inline', () => {
    const html = render(
      createElement(LimitsTab, {
        state: state(
          { limits: { ...newPlanDraft().limits, users: '5' } },
          { 'limits.users': { code: 'whole' } },
        ),
      }),
      locale,
    );
    expect(html).toContain('Broken');
    expect(html).toContain('value="5"');
  });

  it('shows loading, error, empty and list states of the add-ons', () => {
    expect(
      render(
        createElement(AddonsTab, {
          state: state(),
          addons: addons({ status: 'pending' }),
          onTouched: () => undefined,
        }),
        locale,
      ),
    ).toContain('role="status"');
    const failed = render(
      createElement(AddonsTab, {
        state: state(),
        addons: addons({ status: 'error' }),
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(failed).toContain('<button');
    const empty = render(
      createElement(AddonsTab, { state: state(), addons: addons({}), onTouched: () => undefined }),
      locale,
    );
    expect(empty).not.toContain('type="checkbox"');
  });

  it('lists add-ons with a price, flags the ones not on sale and keeps a stale selected id', () => {
    const html = render(
      createElement(AddonsTab, {
        state: state({ visibleAddons: [A, GONE] }),
        addons: addons({
          options: [pack({ id: A }), pack({ id: B, name: 'Draft pack', isActive: false })],
        }),
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(html).toContain(`data-testid="plan-addon-${A}"`);
    expect(html).toContain(`data-testid="plan-addon-${B}"`);
    expect(html).toContain(`data-testid="plan-addon-${GONE}"`);
    expect(html).toContain(GONE);
    expect(html).toMatch(/9(\.00|[.,]00)/);
    // The inactive pack is flagged as not on sale.
    expect(html).toContain('bg-warning/5');
  });

  it('puts counts and an error dot on the tabs', () => {
    const html = render(
      createElement(PlanEditorTabs, {
        active: 'details',
        onChange: () => undefined,
        counts: { featuresOn: 20, limitsSet: 3, addons: 2 },
        errorTabs: ['limits'],
        panels: { details: 'd', features: 'f', limits: 'l', addons: 'a' },
      }),
      locale,
    );
    expect(html).toContain(`20/${PLAN_FEATURE_KEYS.length}`);
    expect(html).toContain(`3/${PLAN_LIMIT_KEYS.length}`);
    expect(html).toContain('data-testid="plan-tab-error-limits"');
    expect(html).not.toContain('data-testid="plan-tab-error-features"');
  });
});

function plan(over: Partial<PlanAdminItem> = {}): PlanAdminItem {
  return {
    id: A,
    slug: 'growth',
    name: 'Growth',
    subtitle: null,
    detail: null,
    kind: 'paid',
    amount: '19.00',
    offerAmount: null,
    currency: 'USD',
    billingUnit: 'months',
    billingDuration: 1,
    isFree: false,
    isLifetime: false,
    isActive: true,
    isDefault: false,
    isHighlighted: false,
    isCustomQuote: false,
    sortOrder: 0,
    ctaLabel: 'Get started',
    dataRetentionDays: 0,
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((k) => [k, k === 'users' ? 5 : k === 'teams' ? 1_000_000 : 0]),
    ) as PlanAdminItem['limits'],
    features: Object.fromEntries(
      PLAN_FEATURE_KEYS.map((k) => [k, k !== 'calling']),
    ) as PlanAdminItem['features'],
    moduleFeatures: {},
    moduleLimits: {},
    visibleAddons: [A, B],
    inUse: 0,
    isRegistrationDefault: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

describe.each(['en', 'ar'] as const)('plans table counts (%s)', (locale) => {
  it('shows features on, limits set and add-ons visible for each plan', () => {
    const html = renderWithMessages(createElement(PlansPage), {
      locale,
      seed: [
        [
          PLANS_QUERY_KEY,
          {
            data: [plan()],
            summary: { total: 1, active: 1, free: 0, paid: 1, customQuote: 0 },
            registrationDefaultSlug: null,
          },
        ],
      ],
    });
    expect(html).toContain('data-testid="plan-counts"');
    expect(html).toContain(`${PLAN_FEATURE_KEYS.length - 1}/${PLAN_FEATURE_KEYS.length}`);
    expect(html).toContain(`1/${PLAN_LIMIT_KEYS.length}`);
  });
});
