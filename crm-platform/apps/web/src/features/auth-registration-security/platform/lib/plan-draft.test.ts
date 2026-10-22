import {
  NEW_PLAN_FEATURES_OFF,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanAdminItem,
} from '@crm/contracts';
import { createPlanRequestSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildPlanRequest,
  addonsSelectedCount,
  clearAddons,
  countFeaturesOn,
  countLimitsSet,
  includedPackCount,
  isPlanDraftDirty,
  limitIsUnlimited,
  newPlanDraft,
  packCoverage,
  planFieldForPath,
  planToDraft,
  problemsFromServer,
  selectAddons,
  setLimitUnlimited,
  setPackIncluded,
  toggleAddon,
  toggleFeatures,
  unknownAddonId,
  unlistedPackFeatures,
  withToggle,
  type PlanDraft,
} from './plan-draft';

const filled = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  ...newPlanDraft(),
  name: 'Pro Plus',
  amount: '49',
  ...over,
});

const stored: PlanAdminItem = {
  id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d11',
  slug: 'growth',
  name: 'Growth',
  subtitle: 'For teams',
  detail: null,
  kind: 'paid',
  amount: '19.00',
  offerAmount: '15.00',
  currency: 'EUR',
  billingUnit: 'months',
  billingDuration: 1,
  isFree: false,
  isLifetime: false,
  isActive: true,
  isDefault: false,
  isHighlighted: true,
  isCustomQuote: false,
  sortOrder: 10,
  ctaLabel: 'Upgrade',
  dataRetentionDays: 0,
  limits: {
    monthly_messages: 10000,
    broadcasts: 0,
    scheduled_messages: 0,
    total_campaigns: 0,
    devices: 3,
    users: 0,
    contacts: 5000,
    tags: 0,
    pipelines: 0,
    appointments: 0,
    saved_replies: 0,
    routing_rules: 0,
    templates: 0,
    flows: 0,
    autoreplies: 0,
    api_rate_limit_per_minute: 0,
    installed_apps: 0,
    lead_sources: 0,
    broadcast_recipients: 0,
    segments: 0,
    custom_fields: 0,
    team_chat_channels: 0,
    sla_policies: 0,
    booking_types: 0,
    chatbot_widgets: 0,
    catalog_products: 0,
    invoices_monthly: 0,
    recurring_invoices: 0,
    api_keys: 0,
    webhooks: 0,
    ai_token_limit_monthly: 0,
    forms: 0,
    form_submissions_monthly: 0,
    ai_form_generations_monthly: 0,
    sms_monthly: 0,
    email_mailboxes: 0,
    email_monthly: 0,
    storage_gb: 0,
    teams: 1_000_000,
  },
  features: {
    automation: true,
    ai_assistants: false,
    calling: false,
    woocommerce: true,
    shopify: false,
    analytics: true,
    remove_branding: false,
    sales_pipeline: true,
    appointment_booking: true,
    appointment_confirm_buttons: true,
    appointment_rebook_steps: true,
    chatbot_widgets: false,
    wa_storefront: false,
    inbox_sla: false,
    inbox_routing: true,
    inbox_assignment_sticky: true,
    waba_calling: true,
    inbox_kanban: true,
    team_performance: true,
    scheduled_messages: true,
    whatsapp_warmer: true,
    marketplace: true,
    lead_sources: true,
    team_chat: true,
    public_api: true,
    outbound_webhooks: true,
    storefront_builder: true,
    invoicing: true,
    forms_and_links: true,
    extra_channels: true,
    form_builder: false,
    waba_groups: false,
    sms: false,
    help_agent: false,
    email_channel: false,
    personal_history_full: false,
    ai_crm_copilot: false,
    lead_scoring: false,
    record_assignment: false,
    team_hierarchy: true,
    custom_roles: true,
  },
  moduleFeatures: {},
  moduleLimits: {},
  visibleAddons: [],
  inUse: 2,
  isRegistrationDefault: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('newPlanDraft', () => {
  it("starts the way Reference's wizard does (active, every limit blank, features on) except the Smart routing and reminder upgrade flags, which start off", () => {
    const d = newPlanDraft();
    expect(d.isActive).toBe(true);
    expect(
      Object.entries(d.features)
        .filter(([, on]) => !on)
        .map(([k]) => k)
        .sort(),
    ).toEqual([
      'appointment_confirm_buttons',
      'appointment_rebook_steps',
      'inbox_assignment_sticky',
      'inbox_routing',
    ]);
    expect(Object.keys(d.features).sort()).toEqual([...PLAN_FEATURE_KEYS].sort());
    expect(Object.values(d.limits).every((v) => v === '')).toBe(true);
    expect(Object.keys(d.limits).sort()).toEqual([...PLAN_LIMIT_KEYS].sort());
    expect(d).toMatchObject({ billingDuration: '1', billingUnit: 'months', sortOrder: '0' });
  });
});

describe('planToDraft', () => {
  it('shows a stored 0 limit as blank, unlimited', () => {
    const d = planToDraft(stored);
    expect(d.limits.monthly_messages).toBe('10000');
    expect(d.limits.users).toBe('');
    expect(d.amount).toBe('19.00');
    expect(d.offerAmount).toBe('15.00');
  });

  it('a free plan shows 0 and a custom quote an empty price', () => {
    expect(
      planToDraft({ ...stored, kind: 'free', isFree: true, amount: '0.00', offerAmount: null })
        .amount,
    ).toBe('0');
    expect(
      planToDraft({
        ...stored,
        kind: 'custom_quote',
        isCustomQuote: true,
        amount: '0.00',
        offerAmount: null,
      }).amount,
    ).toBe('');
  });

  it('round-trips into an unchanged request', () => {
    const built = buildPlanRequest(planToDraft(stored));
    expect(built.problems).toBeUndefined();
    expect(built.body).toMatchObject({
      name: 'Growth',
      subtitle: 'For teams',
      detail: null,
      amount: '19.00',
      offerAmount: '15.00',
      limits: { monthly_messages: 10000, users: 0, contacts: 5000 },
    });
  });
});

describe('withToggle', () => {
  it('a free plan costs nothing and has no offer', () => {
    const d = withToggle(filled({ offerAmount: '39' }), 'isFree', true);
    expect(d).toMatchObject({ isFree: true, amount: '0', offerAmount: '', isCustomQuote: false });
  });

  it('a custom quote has no price and is not free', () => {
    const d = withToggle(filled({ isFree: true }), 'isCustomQuote', true);
    expect(d).toMatchObject({ isCustomQuote: true, isFree: false, amount: '0' });
  });

  it('the signup default must be active; deactivating clears the default', () => {
    expect(withToggle(filled({ isActive: false }), 'isDefault', true)).toMatchObject({
      isDefault: true,
      isActive: true,
    });
    expect(withToggle(filled({ isDefault: true }), 'isActive', false)).toMatchObject({
      isDefault: false,
      isActive: false,
    });
  });

  it('turning free off does not leave the placeholder 0 as the price', () => {
    const free = withToggle(filled(), 'isFree', true);
    expect(withToggle(free, 'isFree', false).amount).toBe('');
  });
});

describe('buildPlanRequest', () => {
  it('builds a normalised request the API schema accepts', () => {
    const built = buildPlanRequest(
      filled({
        amount: '49.5',
        offerAmount: '39',
        subtitle: '  ',
        limits: { ...newPlanDraft().limits, contacts: '500' },
      }),
    );
    expect(built.problems).toBeUndefined();
    expect(built.body).toMatchObject({
      name: 'Pro Plus',
      subtitle: null,
      amount: '49.50',
      offerAmount: '39.00',
      limits: { contacts: 500, monthly_messages: 0 },
    });
    expect(createPlanRequestSchema.safeParse(built.body).success).toBe(true);
  });

  it('requires a name and a price for a paid plan', () => {
    const { problems } = buildPlanRequest(filled({ name: '  ', amount: '' }));
    expect(problems).toMatchObject({ name: { code: 'required' }, amount: { code: 'required' } });
  });

  it('rejects malformed money and does not compare an offer against it', () => {
    const { problems } = buildPlanRequest(filled({ amount: '12,5', offerAmount: '5' }));
    expect(problems?.amount).toEqual({ code: 'money' });
    expect(problems?.offerAmount).toBeUndefined();
  });

  it('the offer must be lower than the price (TW-PLAN-003)', () => {
    expect(
      buildPlanRequest(filled({ amount: '50', offerAmount: '60' })).problems?.offerAmount,
    ).toEqual({
      code: 'offer_not_lower',
    });
    expect(
      buildPlanRequest(filled({ amount: '50', offerAmount: '50' })).problems?.offerAmount?.code,
    ).toBe('offer_not_lower');
  });

  it('an offer of 0 means no offer', () => {
    expect(buildPlanRequest(filled({ offerAmount: '0' })).body?.offerAmount).toBeNull();
  });

  it('a free plan is sent at price 0 with no offer, whatever the price fields hold', () => {
    const body = buildPlanRequest(filled({ isFree: true, amount: '99', offerAmount: '5' })).body;
    expect(body).toMatchObject({ isFree: true, amount: '0.00', offerAmount: null });
  });

  it('a custom quote is sent without a price', () => {
    const body = buildPlanRequest(filled({ isCustomQuote: true, amount: '' })).body;
    expect(body).toMatchObject({ isCustomQuote: true, amount: '0.00', offerAmount: null });
  });

  it('refuses a plan that is both free and a custom quote', () => {
    const { problems } = buildPlanRequest(filled({ isFree: true, isCustomQuote: true }));
    expect(problems?.isFree?.code).toBe('custom_not_free');
  });

  it('refuses an inactive signup default', () => {
    const { problems } = buildPlanRequest(filled({ isDefault: true, isActive: false }));
    expect(problems?.isDefault?.code).toBe('default_needs_active');
  });

  it('checks the billing period, the sort order and every cap', () => {
    const { problems } = buildPlanRequest(
      filled({
        billingDuration: '0',
        sortOrder: '-1',
        limits: { ...newPlanDraft().limits, contacts: '1.5', devices: '99999999999' },
      }),
    );
    expect(problems).toMatchObject({
      billingDuration: { code: 'range', min: 1, max: 120 },
      sortOrder: { code: 'range' },
      'limits.contacts': { code: 'whole' },
      'limits.devices': { code: 'range' },
    });
  });

  it('bounds the text fields', () => {
    const { problems } = buildPlanRequest(
      filled({ name: 'x'.repeat(121), subtitle: 'x'.repeat(192), ctaLabel: '' }),
    );
    expect(problems).toMatchObject({
      name: { code: 'tooLong', max: 120 },
      subtitle: { code: 'tooLong', max: 191 },
      ctaLabel: { code: 'required' },
    });
  });
});

describe('planFieldForPath', () => {
  it('maps API paths to form fields', () => {
    expect(planFieldForPath('offerAmount')).toBe('offerAmount');
    expect(planFieldForPath('limits.contacts')).toBe('limits.contacts');
    expect(planFieldForPath('limits.nope')).toBeNull();
    expect(planFieldForPath('features.analytics')).toBeNull();
  });
});

describe('isPlanDraftDirty', () => {
  it('is false for an untouched draft and true after an edit', () => {
    const d = planToDraft(stored);
    expect(isPlanDraftDirty(d, planToDraft(stored))).toBe(false);
    expect(isPlanDraftDirty(d, { ...d, name: 'Growth 2' })).toBe(true);
  });
});

const A = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d21';
const B = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d22';
const C = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d23';

describe('limits: unlimited <-> 0', () => {
  it('blank and 0 are unlimited, a positive number is a cap', () => {
    expect(limitIsUnlimited('')).toBe(true);
    expect(limitIsUnlimited('  ')).toBe(true);
    expect(limitIsUnlimited('0')).toBe(true);
    expect(limitIsUnlimited('00')).toBe(true);
    expect(limitIsUnlimited('5')).toBe(false);
    expect(limitIsUnlimited('10')).toBe(false);
  });

  it('ticking Unlimited blanks the cap and the request stores 0', () => {
    const d = setLimitUnlimited(
      filled({ limits: { ...newPlanDraft().limits, users: '5' } }),
      'users',
      true,
    );
    expect(d.limits.users).toBe('');
    expect(buildPlanRequest(d).body?.limits?.users).toBe(0);
  });

  it('unticking gives a real cap to edit (never a blank that would read as unlimited again)', () => {
    const d = setLimitUnlimited(filled(), 'users', false);
    expect(limitIsUnlimited(d.limits.users)).toBe(false);
    expect(buildPlanRequest(d).body?.limits?.users).toBe(1);
    expect(
      setLimitUnlimited(filled(), 'api_rate_limit_per_minute', false).limits
        .api_rate_limit_per_minute,
    ).toBe('60');
  });

  it('a stored 0 opens as unlimited and a stored cap does not', () => {
    const d = planToDraft(stored);
    expect(limitIsUnlimited(d.limits.users)).toBe(true);
    expect(limitIsUnlimited(d.limits.monthly_messages)).toBe(false);
  });

  it('counts only capped limits, optionally within a subset', () => {
    const d = filled({
      limits: { ...newPlanDraft().limits, users: '3', contacts: '100', tags: '0' },
    });
    expect(countLimitsSet(d.limits)).toBe(2);
    expect(countLimitsSet(d.limits, ['users', 'tags'])).toBe(1);
    expect(countLimitsSet(newPlanDraft().limits)).toBe(0);
  });
});

describe('features: counts and group toggles', () => {
  it('counts the features that are on', () => {
    expect(countFeaturesOn(newPlanDraft().features)).toBe(
      PLAN_FEATURE_KEYS.length - NEW_PLAN_FEATURES_OFF.length,
    );
    const off = toggleFeatures(newPlanDraft().features, PLAN_FEATURE_KEYS, false);
    expect(countFeaturesOn(off)).toBe(0);
  });

  it('switches only the given (visible) rows and leaves the rest', () => {
    const off = toggleFeatures(newPlanDraft().features, ['automation', 'calling'], false);
    expect(off.automation).toBe(false);
    expect(off.calling).toBe(false);
    expect(off.analytics).toBe(true);
    expect(countFeaturesOn(off, ['automation', 'calling', 'analytics'])).toBe(1);
    const on = toggleFeatures(off, ['automation'], true);
    expect(on.automation).toBe(true);
    expect(on.calling).toBe(false);
  });
});

describe('add-on selection', () => {
  it('toggles one id without duplicating it', () => {
    expect(toggleAddon([], A, true)).toEqual([A]);
    expect(toggleAddon([A], A, true)).toEqual([A]);
    expect(toggleAddon([A, B], A, false)).toEqual([B]);
  });

  it('select all adds the visible ids and keeps the others; clear removes only the visible ones', () => {
    expect(selectAddons([C], [A, B, C])).toEqual([C, A, B]);
    expect(clearAddons([A, B, C], [A, C])).toEqual([B]);
    expect(clearAddons([A], [])).toEqual([A]);
  });
});

describe('buildPlanRequest and visibleAddons', () => {
  it('sends the selection once per id', () => {
    expect(buildPlanRequest(filled({ visibleAddons: [A, B, A] })).body?.visibleAddons).toEqual([
      A,
      B,
    ]);
  });

  it('sends an empty list when the admin cleared everything (it replaces the stored one)', () => {
    expect(buildPlanRequest(filled({ visibleAddons: [] })).body?.visibleAddons).toEqual([]);
  });

  it('omits the field when the options never loaded and the tab was untouched, so the stored selection is kept', () => {
    const body = buildPlanRequest(filled({ visibleAddons: [A] }), { includeAddons: false }).body;
    expect(body).toBeDefined();
    expect('visibleAddons' in body!).toBe(false);
  });

  it('the body still passes the API schema', () => {
    const body = buildPlanRequest(filled({ visibleAddons: [A] })).body;
    expect(createPlanRequestSchema.safeParse(body).success).toBe(true);
  });

  it('opens a stored plan with its add-ons, and a new plan with none', () => {
    expect(planToDraft({ ...stored, visibleAddons: [A, B] }).visibleAddons).toEqual([A, B]);
    expect(newPlanDraft().visibleAddons).toEqual([]);
  });

  it('ticking an add-on off and on again is not a change', () => {
    const base = planToDraft({ ...stored, visibleAddons: [A, B] });
    const moved = {
      ...base,
      visibleAddons: toggleAddon(toggleAddon(base.visibleAddons, A, false), A, true),
    };
    expect(isPlanDraftDirty(base, moved)).toBe(false);
    expect(isPlanDraftDirty(base, { ...base, visibleAddons: [A] })).toBe(true);
  });
});

describe('server errors', () => {
  it('maps visibleAddons to its own field', () => {
    expect(planFieldForPath('visibleAddons')).toBe('visibleAddons');
  });

  it('reads the unknown add-on id from the API message', () => {
    expect(unknownAddonId(`unknown_addon:${A}`)).toBe(A);
    expect(unknownAddonId('List each add-on once.')).toBeNull();
    expect(unknownAddonId('unknown_addon:')).toBeNull();
  });

  it('folds every unknown add-on into one visibleAddons problem and keeps other fields', () => {
    const problems = problemsFromServer([
      { path: 'visibleAddons', message: `unknown_addon:${A}` },
      { path: 'visibleAddons', message: `unknown_addon:${B}` },
      { path: 'visibleAddons', message: `unknown_addon:${A}` },
      { path: 'name', message: 'Name is taken.' },
      { path: 'limits.users', message: 'Too big.' },
      { path: 'nonsense', message: 'ignored' },
    ]);
    expect(problems.visibleAddons).toEqual({ code: 'server', ids: [A, B] });
    expect(problems.name).toEqual({ code: 'server', message: 'Name is taken.' });
    expect(problems['limits.users']).toEqual({ code: 'server', message: 'Too big.' });
    expect(Object.keys(problems)).toHaveLength(3);
  });

  it('shows another visibleAddons message (a duplicate, say) as the API said it', () => {
    expect(
      problemsFromServer([{ path: 'visibleAddons', message: 'List each add-on once.' }])
        .visibleAddons,
    ).toEqual({ code: 'server', message: 'List each add-on once.' });
  });
});

describe('module-contributed plan keys (TW-ADD-013)', () => {
  it('come from the stored plan, can be edited, and travel apart from the registry keys', () => {
    const d = planToDraft({
      ...stored,
      moduleFeatures: { ig_automation: true },
      moduleLimits: { ig_accounts: 3 },
    });
    expect(d.features.ig_automation).toBe(true);
    expect(d.limits.ig_accounts).toBe('3');
    const built = buildPlanRequest({ ...d, limits: { ...d.limits, ig_accounts: '5' } });
    expect(built.problems).toBeUndefined();
    expect(built.body).toMatchObject({
      moduleFeatures: { ig_automation: true },
      moduleLimits: { ig_accounts: 5 },
    });
    expect(built.body?.features).not.toHaveProperty('ig_automation');
    expect(built.body?.limits).not.toHaveProperty('ig_accounts');
    const parsed = createPlanRequestSchema.parse(built.body);
    expect(parsed.moduleLimits.ig_accounts).toBe(5);
  });

  it('a blank module cap is 0 and a bad one is a problem on that field', () => {
    const d = filled();
    expect(
      buildPlanRequest({ ...d, limits: { ...d.limits, x_cap: '' } }).body?.moduleLimits,
    ).toEqual({ x_cap: 0 });
    expect(
      buildPlanRequest({ ...d, limits: { ...d.limits, x_cap: 'abc' } }).problems,
    ).toHaveProperty(['limits.x_cap']);
  });
});

describe('the teams cap (0 is solo, blank is unlimited)', () => {
  const withTeams = (n: number) => ({ ...stored, limits: { ...stored.limits, teams: n } });

  it('shows the unlimited stand-in as blank and a real 0 as 0', () => {
    expect(planToDraft(withTeams(1_000_000)).limits.teams).toBe('');
    expect(planToDraft(withTeams(0)).limits.teams).toBe('0');
    expect(planToDraft(withTeams(5)).limits.teams).toBe('5');
  });

  it('saves blank as unlimited, 0 as solo and a number as itself; other caps keep blank = 0', () => {
    const d = planToDraft(stored);
    expect(
      buildPlanRequest({ ...d, limits: { ...d.limits, teams: '' } }).body?.limits,
    ).toMatchObject({
      teams: 1_000_000,
      users: 0,
    });
    expect(buildPlanRequest({ ...d, limits: { ...d.limits, teams: '0' } }).body?.limits.teams).toBe(
      0,
    );
    expect(buildPlanRequest({ ...d, limits: { ...d.limits, teams: '7' } }).body?.limits.teams).toBe(
      7,
    );
  });

  it('only a blank teams box counts as unlimited; a typed 0 is a cap', () => {
    expect(limitIsUnlimited('', 'teams')).toBe(true);
    expect(limitIsUnlimited('0', 'teams')).toBe(false);
    expect(limitIsUnlimited('0', 'users')).toBe(true);
    expect(countLimitsSet({ teams: '0', users: '' }, ['teams', 'users'])).toBe(1);
  });
});

describe('plain add-on packs included in the plan (derived from the features)', () => {
  const SMART = { grants: { features: ['inbox_routing', 'inbox_assignment_sticky'], limits: {} } };
  const TEAMS = {
    grants: { features: ['team_hierarchy', 'custom_roles'], limits: { teams: 10 } },
  };
  const LIMITS_ONLY = { grants: { features: [], limits: { teams: 5 } } };
  const OUTSIDE = { grants: { features: ['inbox_routing', 'some_module_flag'], limits: {} } };
  const allOff = () => toggleFeatures(newPlanDraft().features, PLAN_FEATURE_KEYS, false);

  it('reads none / partial / full from the plan features', () => {
    const none = packCoverage(SMART, allOff());
    expect(none).toEqual({
      state: 'none',
      on: 0,
      total: 2,
      missing: ['inbox_routing', 'inbox_assignment_sticky'],
    });
    const part = packCoverage(SMART, { ...allOff(), inbox_routing: true });
    expect(part.state).toBe('partial');
    expect(part.missing).toEqual(['inbox_assignment_sticky']);
    expect(
      packCoverage(SMART, { ...allOff(), inbox_routing: true, inbox_assignment_sticky: true })
        .state,
    ).toBe('full');
  });

  it('a new plan starts without Smart routing (NEW_PLAN_FEATURES_OFF), so the pack starts as none', () => {
    expect(packCoverage(SMART, newPlanDraft().features).state).toBe('none');
    for (const k of NEW_PLAN_FEATURES_OFF) expect(newPlanDraft().features[k]).toBe(false);
  });

  it('a pack with no feature keys (limits only) has nothing to include and is never changed', () => {
    expect(packCoverage(LIMITS_ONLY, newPlanDraft().features).state).toBe('noFeatures');
    const d = filled();
    expect(setPackIncluded(d, LIMITS_ONLY, true)).toBe(d);
    expect(setPackIncluded(d, LIMITS_ONLY, false)).toBe(d);
  });

  it('switching on ticks exactly the pack keys; the Features tab flips the state both ways', () => {
    const d = { ...filled(), features: allOff() };
    const on = setPackIncluded(d, SMART, true);
    expect(on.features.inbox_routing).toBe(true);
    expect(on.features.inbox_assignment_sticky).toBe(true);
    expect(countFeaturesOn(on.features)).toBe(2);
    expect(packCoverage(SMART, on.features).state).toBe('full');
    // one key ticked away on the Features tab makes the pack partial, ticking it back makes it full again
    const featuresTab = { ...on.features, inbox_routing: false };
    expect(packCoverage(SMART, featuresTab).state).toBe('partial');
    expect(packCoverage(SMART, { ...featuresTab, inbox_routing: true }).state).toBe('full');
    // both keys ticked on the Features tab (no switch involved) read as included
    expect(
      packCoverage(
        SMART,
        toggleFeatures(allOff(), ['inbox_routing', 'inbox_assignment_sticky'], true),
      ).state,
    ).toBe('full');
  });

  it('"include fully" on a partly covered pack completes it without touching other features', () => {
    const d = { ...filled(), features: { ...allOff(), inbox_routing: true, sales_pipeline: true } };
    const done = setPackIncluded(d, SMART, true);
    expect(packCoverage(SMART, done.features).state).toBe('full');
    expect(done.features.sales_pipeline).toBe(true);
    expect(countFeaturesOn(done.features)).toBe(3);
  });

  it('switching off writes false explicitly (it does not restore a previous value and does not delete the key)', () => {
    const d = { ...filled(), features: { ...allOff(), inbox_routing: true } };
    const on = setPackIncluded(d, SMART, true);
    const off = setPackIncluded(on, SMART, false);
    expect(off.features.inbox_routing).toBe(false);
    expect(off.features.inbox_assignment_sticky).toBe(false);
    expect('inbox_routing' in off.features).toBe(true);
    expect(packCoverage(SMART, off.features).state).toBe('none');
  });

  it('a pack with limits: only its features move; the limit values are left exactly as they are', () => {
    const d = filled({ limits: { ...newPlanDraft().limits, teams: '7' } });
    const on = setPackIncluded(d, TEAMS, true);
    expect(on.features.team_hierarchy).toBe(true);
    expect(on.features.custom_roles).toBe(true);
    expect(on.limits).toEqual(d.limits);
    expect(setPackIncluded(on, TEAMS, false).limits).toEqual(d.limits);
  });

  it('does not touch the Marketplace selection or the rest of the draft', () => {
    const d = filled({ visibleAddons: ['a', 'b'] });
    const on = setPackIncluded(d, SMART, true);
    expect(on.visibleAddons).toEqual(['a', 'b']);
    expect({ ...on, features: d.features }).toEqual(d);
  });

  it('keys outside the catalogue can be ticked on the plan and are stored as module features', () => {
    expect(unlistedPackFeatures(OUTSIDE)).toEqual(['some_module_flag']);
    expect(unlistedPackFeatures(SMART)).toEqual([]);
    const on = setPackIncluded(filled(), OUTSIDE, true);
    expect(packCoverage(OUTSIDE, on.features).state).toBe('full');
    const body = buildPlanRequest(on).body!;
    expect(body.moduleFeatures.some_module_flag).toBe(true);
    expect(body.features.inbox_routing).toBe(true);
    const off = buildPlanRequest(setPackIncluded(on, OUTSIDE, false)).body!;
    expect(off.moduleFeatures.some_module_flag).toBe(false);
  });

  it('a plan saved from the editor stores every feature key explicitly, on and off', () => {
    const off = buildPlanRequest(setPackIncluded(filled(), SMART, false)).body!;
    for (const k of PLAN_FEATURE_KEYS) expect(typeof off.features[k]).toBe('boolean');
    expect(off.features.inbox_routing).toBe(false);
    const on = buildPlanRequest(setPackIncluded(filled(), SMART, true)).body!;
    for (const k of PLAN_FEATURE_KEYS) expect(typeof on.features[k]).toBe('boolean');
    expect(on.features.inbox_routing).toBe(true);
    expect(on.features.inbox_assignment_sticky).toBe(true);
  });

  it('editing a plan that already has the keys on: the pack reads full and a save keeps them on', () => {
    const plan = planToDraft({
      ...stored,
      features: { ...stored.features, inbox_routing: true, inbox_assignment_sticky: true },
    });
    expect(packCoverage(SMART, plan.features).state).toBe('full');
    expect(buildPlanRequest(plan).body!.features.inbox_routing).toBe(true);
  });

  it('counts fully included packs plus the Marketplace apps offered (a partly covered pack is not counted)', () => {
    const features = {
      ...allOff(),
      inbox_routing: true,
      inbox_assignment_sticky: true,
      team_hierarchy: true,
    };
    expect(includedPackCount([SMART, TEAMS, LIMITS_ONLY], features)).toBe(1);
    expect(
      addonsSelectedCount({ features, visibleAddons: ['a', 'b'] }, [SMART, TEAMS, LIMITS_ONLY]),
    ).toBe(3);
    expect(addonsSelectedCount({ features: allOff(), visibleAddons: [] }, [])).toBe(0);
  });

  it('the draft is dirty after a switch and clean again after it is put back', () => {
    const initial = { ...filled(), features: allOff() };
    const on = setPackIncluded(initial, SMART, true);
    expect(isPlanDraftDirty(initial, on)).toBe(true);
    expect(isPlanDraftDirty(initial, setPackIncluded(on, SMART, false))).toBe(false);
  });
});
