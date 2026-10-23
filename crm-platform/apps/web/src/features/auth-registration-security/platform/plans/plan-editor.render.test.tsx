import { createElement } from 'react';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type AddonPack,
  type PlanAddonOption,
  type PlanAdminItem,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { newPlanDraft, type PlanDraft, type PlanProblems } from '../lib/plan-draft';
import { renderWithMessages } from '../render-test-utils';
import { AddonsTab, type AddonOptionsState, type IncludedPacksState } from './addons-tab';
import { AppOffersTab } from './app-offers-tab';
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
  app: { id: B, slug: 'appointments', name: 'Appointments', status: 'published', kind: 'mini_app' },
  ...over,
});

const addons = (over: Partial<AddonOptionsState>): AddonOptionsState => ({
  status: 'success',
  options: [],
  retry: () => undefined,
  ...over,
});

const RAZOR = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d30';
const razorpay = (over: Partial<PlanAddonOption> = {}): PlanAddonOption =>
  pack({
    id: RAZOR,
    packSlug: 'mkt_razorpay',
    name: 'Razorpay pack',
    app: {
      id: RAZOR,
      slug: 'razorpay',
      name: 'Razorpay',
      status: 'published',
      kind: 'integration',
    },
    ...over,
  });

const SMART = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e01';
const TEAMS = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e02';
const LIMITS_ONLY = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e03';

const plain = (over: Partial<AddonPack> & { id: string }): AddonPack => ({
  slug: 'smart_routing',
  name: 'Smart routing',
  subtitle: null,
  detail: null,
  amount: '9.00',
  offerAmount: null,
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: 1,
  billingMode: 'recurring',
  isFree: false,
  isLifetime: false,
  isActive: true,
  sortOrder: 0,
  grants: { features: ['inbox_routing', 'inbox_assignment_sticky'], limits: {} },
  activePurchases: 0,
  kind: 'feature',
  planOffers: [],
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const included = (over: Partial<IncludedPacksState> = {}): IncludedPacksState => ({
  status: 'success',
  packs: [],
  retry: () => undefined,
  impact: new Map(),
  ...over,
});

const SAVED: PlanDraft['addonOffers'] = {};

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

  const appsTab = (
    tab: 'integrations' | 'miniApps',
    over: Partial<Parameters<typeof AppOffersTab>[0]> = {},
  ) =>
    createElement(AppOffersTab, {
      tab,
      state: state(),
      addons: addons({}),
      onTouched: () => undefined,
      ...over,
    });

  it('shows loading, error and empty states on the app tabs', () => {
    expect(
      render(appsTab('miniApps', { addons: addons({ status: 'pending' }) }), locale),
    ).toContain('role="status"');
    expect(
      render(appsTab('integrations', { addons: addons({ status: 'error' }) }), locale),
    ).toContain('<button');
    const empty = render(appsTab('miniApps'), locale);
    expect(empty).not.toContain('type="radio"');
    expect(empty).toContain('border-dashed');
    // Integrations with only a mini app listed is still empty, and says where Shopify and WooCommerce are switched on
    const noIntegrations = render(
      appsTab('integrations', { addons: addons({ options: [pack({ id: A })] }) }),
      locale,
    );
    expect(noIntegrations).not.toContain('type="radio"');
    if (locale === 'en') {
      expect(noIntegrations).toContain('No paid integrations yet');
      expect(noIntegrations).toContain('Shopify and WooCommerce are switched on the Features tab.');
    }
  });

  it('lists each app on the tab of its kind, with name, slug, price, badges and the same three modes', () => {
    const options = [
      pack({ id: A }),
      pack({ id: B, name: 'Draft pack', isActive: false }),
      razorpay(),
    ];
    const minis = render(appsTab('miniApps', { addons: addons({ options }) }), locale);
    expect(minis).toContain(`data-testid="plan-addon-${A}"`);
    expect(minis).toContain(`data-testid="plan-addon-${B}"`);
    expect(minis).not.toContain(`data-testid="plan-addon-${RAZOR}"`);
    const integrations = render(appsTab('integrations', { addons: addons({ options }) }), locale);
    expect(integrations).toContain(`data-testid="plan-addon-${RAZOR}"`);
    expect(integrations).not.toContain(`data-testid="plan-addon-${A}"`);
    expect(integrations).toContain('razorpay');
    expect(integrations).toMatch(/9(\.00|[.,]00)/);
    // one radiogroup per row, native radios Included | Paid | Hidden, and never a price box
    expect(minis.match(/role="radiogroup"/g)).toHaveLength(2);
    for (const m of ['included', 'paid', 'hidden'])
      expect(integrations).toContain(`data-testid="plan-app-offer-${RAZOR}-${m}"`);
    expect(minis).not.toContain('inputMode="decimal"');
    expect(minis).not.toContain('id="plan-addonOffers-');
    // a pack that is switched off is flagged as not on sale
    expect(minis).toContain('text-warning');
  });

  it('shows the mode the plan holds: no entry is Hidden, visible is Paid, an Included row is Included', () => {
    const html = render(
      appsTab('miniApps', {
        state: state({
          visibleAddons: [A, B],
          addonOffers: { [B]: { mode: 'included', amount: '' } },
        }),
        addons: addons({
          options: [
            pack({ id: A }),
            pack({ id: B, name: 'Forms' }),
            pack({ id: GONE, name: 'Other' }),
          ],
        }),
      }),
      locale,
    );
    expect(html).toMatch(new RegExp(`data-testid="plan-addon-${A}"[^>]*data-mode="paid"`));
    expect(html).toMatch(new RegExp(`data-testid="plan-addon-${B}"[^>]*data-mode="included"`));
    expect(html).toMatch(new RegExp(`data-testid="plan-addon-${GONE}"[^>]*data-mode="hidden"`));
    // the bulk helper offers the same three modes
    for (const m of ['included', 'paid', 'hidden'])
      expect(html).toContain(`data-testid="plan-apps-miniApps-all-${m}"`);
  });

  it('shows an offer error on the row of its app', () => {
    const html = render(
      appsTab('integrations', {
        state: state({}, { [`addonOffers.${RAZOR}`]: { code: 'server' } }),
        addons: addons({ options: [razorpay()] }),
      }),
      locale,
    );
    expect(html).toContain(`id="plan-addonOffers-${RAZOR}"`);
    expect(html).toContain('Broken');
  });

  it('locks every app control for an operator who cannot edit plans', () => {
    const html = render(
      appsTab('integrations', { addons: addons({ options: [razorpay()] }), readOnly: true }),
      locale,
    );
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r).toContain('disabled');
    for (const m of ['included', 'paid', 'hidden'])
      expect(html).toMatch(
        new RegExp(`<button[^>]*disabled[^>]*data-testid="plan-apps-integrations-all-${m}"`),
      );
  });

  it('the Add-ons tab lists no apps; it only keeps a selected id nothing lists, so it can be removed', () => {
    const none = render(
      createElement(AddonsTab, {
        state: state({ visibleAddons: [A] }),
        addons: addons({ options: [pack({ id: A }), razorpay()] }),
        included: included(),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(none).not.toContain(`plan-addon-${A}`);
    expect(none).not.toContain(`plan-addon-${RAZOR}`);
    expect(none).not.toContain('plan-stale-addons');
    const stale = render(
      createElement(AddonsTab, {
        state: state({ visibleAddons: [A, GONE] }),
        addons: addons({ options: [pack({ id: A })] }),
        included: included(),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(stale).toContain(`data-testid="plan-addon-${GONE}"`);
    expect(stale).toContain(GONE);
    expect(stale).not.toContain(`data-testid="plan-addon-${A}"`);
  });

  it('groups the plain add-ons into Feature and Capacity sections, apart from the mini apps', () => {
    const html = render(
      createElement(AddonsTab, {
        state: state({ addonOffers: { [SMART]: { mode: 'included', amount: '' } } }),
        addons: addons({ options: [pack({ id: A })] }),
        included: included({
          packs: [
            plain({ id: SMART }),
            plain({
              id: LIMITS_ONLY,
              name: 'More teams',
              kind: 'capacity',
              grants: { features: [], limits: { teams: 5 } },
            }),
          ],
        }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(html).toMatch(
      new RegExp(`data-testid="plan-pack-${SMART}" data-kind="feature" data-mode="included"`),
    );
    expect(html).toMatch(
      new RegExp(`data-testid="plan-pack-${LIMITS_ONLY}" data-kind="capacity" data-mode="paid"`),
    );
    // the feature section comes before the capacity section; no Marketplace app is listed on this tab
    expect(html.indexOf(`plan-pack-${SMART}`)).toBeLessThan(
      html.indexOf(`plan-pack-${LIMITS_ONLY}`),
    );
    expect(html).not.toContain(`plan-addon-${A}`);
    expect(html.match(/role="radiogroup"/g)).toHaveLength(2);
    // Included is offered for the feature add-on, never for the capacity one (which says why)
    expect(html).toContain(`data-testid="plan-offer-${SMART}-included"`);
    expect(html).not.toContain(`data-testid="plan-offer-${LIMITS_ONLY}-included"`);
    expect(html).toContain(`data-testid="plan-offer-${LIMITS_ONLY}-paid"`);
    expect(html).toContain(`data-testid="plan-offer-${LIMITS_ONLY}-hidden"`);
    expect(html).toContain(`aria-describedby="plan-offer-${LIMITS_ONLY}-reason"`);
    expect(html).toContain(`id="plan-offer-${LIMITS_ONLY}-reason"`);
    // Paid shows the optional price box, with the add-on's own price as its placeholder
    expect(html).toContain(`id="plan-addonOffers-${LIMITS_ONLY}"`);
    expect(html).toContain('placeholder="9.00"');
    expect(html).not.toContain(`id="plan-addonOffers-${SMART}"`);
  });

  it('a feature add-on with no features yet (Smart routing style) stays under Feature add-ons; Included is disabled with a reason', () => {
    const EMPTY = plain({
      id: SMART,
      kind: 'feature',
      grants: { features: [], limits: {} },
    });
    // a capacity add-on that (as stored data) has features is not a feature add-on: the stored kind decides
    const html = render(
      createElement(AddonsTab, {
        state: state(),
        addons: addons({}),
        included: included({
          packs: [
            EMPTY,
            plain({
              id: LIMITS_ONLY,
              name: 'More teams',
              kind: 'capacity',
              grants: { features: [], limits: { teams: 5 } },
            }),
          ],
        }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(html).toMatch(new RegExp(`data-testid="plan-pack-${SMART}" data-kind="feature"`));
    expect(html).toMatch(new RegExp(`data-testid="plan-pack-${LIMITS_ONLY}" data-kind="capacity"`));
    expect(html.indexOf(`plan-pack-${SMART}`)).toBeLessThan(
      html.indexOf(`plan-pack-${LIMITS_ONLY}`),
    );
    const included_ = new RegExp(
      `<input[^>]*data-testid="plan-offer-${SMART}-included"[^>]*>|<input[^>]*value="included"[^>]*data-testid="plan-offer-${SMART}-included"[^>]*>`,
    ).exec(html)?.[0];
    expect(included_).toBeDefined();
    expect(included_).toContain('disabled');
    // Paid and Hidden stay choosable
    const paid = new RegExp(`<input[^>]*data-testid="plan-offer-${SMART}-paid"[^>]*>`).exec(
      html,
    )?.[0];
    expect(paid).not.toContain('disabled');
    expect(html).toContain(`aria-describedby="plan-offer-${SMART}-reason"`);
    expect(html).toContain(`id="plan-offer-${SMART}-reason"`);
    if (locale === 'en')
      expect(html).toContain('Add the features it unlocks in Add-ons &gt; Smart routing first');
  });

  it('omits the capacity section when no add-on is limits-only, and flags one not on sale', () => {
    const html = render(
      createElement(AddonsTab, {
        state: state(),
        addons: addons({}),
        included: included({ packs: [plain({ id: SMART, isActive: false })] }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(html).not.toContain('data-kind="capacity"');
    expect(html).toContain('bg-warning/5');
    expect(html.match(/<h3/g)).toHaveLength(1);
  });

  it('a hidden add-on has no price box; a price problem shows on its row', () => {
    const html = render(
      createElement(AddonsTab, {
        state: state(
          {
            addonOffers: {
              [SMART]: { mode: 'hidden', amount: '' },
              [TEAMS]: { mode: 'paid', amount: '0' },
            },
          },
          { [`addonOffers.${TEAMS}`]: { code: 'addonPriceZero' } },
        ),
        addons: addons({}),
        included: included({ packs: [plain({ id: SMART }), plain({ id: TEAMS, name: 'Teams' })] }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(html).toContain(`data-mode="hidden"`);
    expect(html).not.toContain(`id="plan-addonOffers-${SMART}"`);
    expect(html).toContain(`id="plan-addonOffers-${TEAMS}"`);
    expect(html).toContain('Broken');
  });

  it('says how many workspaces stop renewing when an add-on becomes included, and what is lost when it stops', () => {
    const teams = render(
      createElement(AddonsTab, {
        state: state({ addonOffers: { [TEAMS]: { mode: 'included', amount: '' } } }),
        addons: addons({}),
        included: included({
          packs: [
            plain({
              id: TEAMS,
              slug: 'teams',
              name: 'Teams and permissions',
              grants: { features: ['team_hierarchy', 'custom_roles'], limits: { teams: 10 } },
            }),
          ],
          impact: new Map([[TEAMS, 3]]),
        }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    // A pack that also sells a cap is never stopped by inclusion: no renewal-stop sentence for it.
    expect(teams).not.toContain('role="status"');
    const stops = render(
      createElement(AddonsTab, {
        state: state({ addonOffers: { [SMART]: { mode: 'included', amount: '' } } }),
        addons: addons({}),
        included: included({ packs: [plain({ id: SMART })], impact: new Map([[SMART, 4]]) }),
        savedOffers: SAVED,
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(stops).toContain('role="status"');
    expect(stops).toContain('4');
    const off = render(
      createElement(AddonsTab, {
        state: state(),
        addons: addons({}),
        included: included({ packs: [plain({ id: SMART })] }),
        savedOffers: { [SMART]: { mode: 'included', amount: '' } },
        onTouched: () => undefined,
      }),
      locale,
    );
    expect(off).toContain('role="status"');
  });

  it('locks every control for an operator who cannot edit plans', () => {
    const html = render(
      createElement(AddonsTab, {
        state: state(),
        addons: addons({}),
        included: included({ packs: [plain({ id: SMART })] }),
        savedOffers: SAVED,
        readOnly: true,
        onTouched: () => undefined,
      }),
      locale,
    );
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    for (const r of radios) expect(r).toContain('disabled');
    expect(html).toMatch(/<input[^>]*id="plan-addonOffers-[^"]*"[^>]*disabled/);
  });

  it('the Features tab shows a key an add-on grants read-only, naming the add-on', () => {
    const html = render(
      createElement(FeaturesTab, {
        state: state({ addonOffers: { [SMART]: { mode: 'included', amount: '' } } }),
        packs: [plain({ id: SMART })],
      }),
      locale,
    );
    expect(html).toContain('data-testid="plan-feature-inbox_routing-locked"');
    expect(html).toContain('data-testid="plan-feature-inbox_assignment_sticky-locked"');
    expect(html).not.toContain('data-testid="plan-feature-sales_pipeline-locked"');
    expect(html).toMatch(
      /<button[^>]*id="plan-feature-inbox_routing"[^>]*>|<button[^>]*role="switch"[^>]*id="plan-feature-inbox_routing"/,
    );
    const sw = /<button[^>]*id="plan-feature-inbox_routing"[^>]*>/.exec(html)?.[0] ?? '';
    expect(sw).toContain('disabled');
    // shown as the save will store it: included -> on
    expect(sw).toContain('aria-checked="true"');
    expect(html).toContain('Smart routing');
    // nothing is locked while the add-ons are not known
    expect(render(createElement(FeaturesTab, { state: state() }), locale)).not.toContain(
      '-locked"',
    );
  });

  it('puts counts and an error dot on the tabs', () => {
    const html = render(
      createElement(PlanEditorTabs, {
        active: 'details',
        onChange: () => undefined,
        counts: { featuresOn: 20, limitsSet: 3, addons: 2, integrations: 4, miniApps: 7 },
        errorTabs: ['limits'],
        panels: {
          details: 'd',
          features: 'f',
          limits: 'l',
          addons: 'a',
          integrations: 'i',
          miniApps: 'm',
        },
      }),
      locale,
    );
    expect(html).toContain(`20/${PLAN_FEATURE_KEYS.length}`);
    expect(html).toContain(`3/${PLAN_LIMIT_KEYS.length}`);
    expect(html).toContain('data-testid="plan-tab-error-limits"');
    expect(html).not.toContain('data-testid="plan-tab-error-features"');
    // six tabs in order, each of the last three with its own count chip
    const tabs = [...html.matchAll(/role="tab"/g)];
    expect(tabs).toHaveLength(6);
    expect(html).toMatch(/aria-hidden="true">2<\/span>/);
    expect(html).toMatch(/aria-hidden="true">4<\/span>/);
    expect(html).toMatch(/aria-hidden="true">7<\/span>/);
    if (locale === 'en') {
      const labels = [
        'Details and pricing',
        'Features',
        'Limits',
        'Add-ons',
        'Integrations',
        'Mini apps',
      ];
      const at = labels.map((l) => html.indexOf(l));
      expect(at.every((i) => i >= 0)).toBe(true);
      expect([...at].sort((x, y) => x - y)).toEqual(at);
      expect(html).toContain('Integrations included or offered: 4');
      expect(html).toContain('Mini apps included or offered: 7');
    }
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
    addonOffers: [],
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
