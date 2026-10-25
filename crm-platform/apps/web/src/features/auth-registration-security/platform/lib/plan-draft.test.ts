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
  appModeFor,
  appsOfferedCount,
  canIncludePack,
  countFeaturesOn,
  countLimitsSet,
  includedPackCount,
  isPlanDraftDirty,
  limitIsUnlimited,
  newPlanDraft,
  offerFeatures,
  offerFor,
  offerModesFor,
  packLockedFeatures,
  planFieldForPath,
  planToDraft,
  problemsFromServer,
  packKind,
  packsOfferedCount,
  setAddonOffer,
  setAddonOfferAmount,
  setAppOffer,
  setAppOffers,
  setLimitUnlimited,
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
    webbot_messages: 0,
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
    agent_status_bar: true,
    agent_status_automation: true,
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
  addonOffers: [],
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
      'agent_status_automation',
      'agent_status_bar',
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

describe('plain add-on offers (Included | Paid | Hidden per plan)', () => {
  const SMART = {
    id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e01',
    name: 'Smart routing',
    grants: { features: ['inbox_routing', 'inbox_assignment_sticky'], limits: {} },
  };
  const TEAMS = {
    id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e02',
    name: 'Teams and permissions',
    grants: { features: ['team_hierarchy', 'custom_roles'], limits: { teams: 10 } },
  };
  const SEATS = {
    id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e03',
    name: 'Extra seat',
    grants: { features: [], limits: { users: 1 } },
  };
  const OUTSIDE = {
    id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e04',
    name: 'Module pack',
    grants: { features: ['inbox_routing', 'some_module_flag'], limits: {} },
  };
  const PACKS = [SMART, TEAMS, SEATS];
  const allOff = () => toggleFeatures(newPlanDraft().features, PLAN_FEATURE_KEYS, false);

  it('a draft starts from the stored offers; a pack with no row is paid at the add-on price', () => {
    const d = planToDraft({
      ...stored,
      addonOffers: [
        { addonId: SMART.id, mode: 'included', amount: null },
        { addonId: SEATS.id, mode: 'paid', amount: '199.00' },
        { addonId: OUTSIDE.id, mode: 'hidden', amount: null },
      ],
    });
    expect(offerFor(d, SMART.id)).toEqual({ mode: 'included', amount: '' });
    expect(offerFor(d, SEATS.id)).toEqual({ mode: 'paid', amount: '199.00' });
    expect(offerFor(d, OUTSIDE.id)).toEqual({ mode: 'hidden', amount: '' });
    expect(offerFor(d, TEAMS.id)).toEqual({ mode: 'paid', amount: '' });
    expect(newPlanDraft().addonOffers).toEqual({});
    // an older API without the field reads as "nothing stored"
    expect(planToDraft({ ...stored, addonOffers: undefined as never }).addonOffers).toEqual({});
  });

  it('a capacity add-on (limits only) offers Paid | Hidden, never Included', () => {
    expect(offerModesFor(SMART)).toEqual(['included', 'paid', 'hidden']);
    expect(offerModesFor(TEAMS)).toEqual(['included', 'paid', 'hidden']);
    expect(offerModesFor(SEATS)).toEqual(['paid', 'hidden']);
    const d = filled();
    expect(setAddonOffer(d, SEATS, 'included', PACKS)).toBe(d);
    expect(offerFor(setAddonOffer(d, SEATS, 'hidden', PACKS), SEATS.id).mode).toBe('hidden');
  });

  it('choosing a mode sets the pack feature keys: included -> on, paid or hidden -> off', () => {
    const d = { ...filled(), features: allOff() };
    const on = setAddonOffer(d, SMART, 'included', PACKS);
    expect(on.features.inbox_routing).toBe(true);
    expect(on.features.inbox_assignment_sticky).toBe(true);
    expect(countFeaturesOn(on.features)).toBe(2);
    const hidden = setAddonOffer(on, SMART, 'hidden', PACKS);
    expect(hidden.features.inbox_routing).toBe(false);
    expect(hidden.features.inbox_assignment_sticky).toBe(false);
    expect('inbox_routing' in hidden.features).toBe(true);
    const paid = setAddonOffer(on, SMART, 'paid', PACKS);
    expect(paid.features.inbox_routing).toBe(false);
  });

  it('a pack with limits: only its features move; limits and the rest of the draft stay', () => {
    const d = filled({ limits: { ...newPlanDraft().limits, teams: '7' }, visibleAddons: ['a'] });
    const on = setAddonOffer(d, TEAMS, 'included', PACKS);
    expect(on.features.team_hierarchy).toBe(true);
    expect(on.limits).toEqual(d.limits);
    expect({ ...on, features: d.features, addonOffers: d.addonOffers }).toEqual(d);
  });

  it('a key two packs share stays on while one of them is included', () => {
    const packs = [SMART, OUTSIDE];
    const d = setAddonOffer(
      setAddonOffer(filled(), SMART, 'included', packs),
      OUTSIDE,
      'hidden',
      packs,
    );
    expect(d.features.inbox_routing).toBe(true);
    expect(d.features.some_module_flag).toBe(false);
    expect(offerFeatures(d, packs)).toEqual({
      inbox_routing: true,
      inbox_assignment_sticky: true,
      some_module_flag: false,
    });
  });

  it('a plan price is kept only while paid; switching away forgets it', () => {
    const d = setAddonOfferAmount(filled(), SMART.id, '199');
    expect(offerFor(d, SMART.id)).toEqual({ mode: 'paid', amount: '199' });
    const inc = setAddonOffer(d, SMART, 'included', PACKS);
    expect(offerFor(inc, SMART.id).amount).toBe('');
    // a price cannot be typed for a hidden add-on
    const hid = setAddonOffer(filled(), SMART, 'hidden', PACKS);
    expect(setAddonOfferAmount(hid, SMART.id, '5')).toBe(hid);
  });

  it("the request carries the offers the plan holds, and those packs' features follow them", () => {
    const d = setAddonOfferAmount(
      setAddonOffer(
        setAddonOffer({ ...filled(), features: allOff() }, SMART, 'included', PACKS),
        SEATS,
        'paid',
        PACKS,
      ),
      SEATS.id,
      ' 199 ',
    );
    const body = buildPlanRequest(d, { addonPacks: PACKS }).body!;
    expect(body.addonOffers).toEqual([
      { addonId: SMART.id, mode: 'included', amount: null },
      { addonId: SEATS.id, mode: 'paid', amount: '199.00' },
    ]);
    expect(body.features.inbox_routing).toBe(true);
    // an untouched plan with no stored offer sends none: nothing about any add-on changes
    expect(buildPlanRequest(filled(), { addonPacks: PACKS }).body!.addonOffers).toEqual([]);
    expect(createPlanRequestSchema.safeParse(body).success).toBe(true);
  });

  it('a plan that carries only part of an add-on keeps it on a save that never touched the add-on', () => {
    const d = filled({ features: { ...allOff(), inbox_routing: true, team_hierarchy: true } });
    const body = buildPlanRequest(d, { addonPacks: PACKS }).body!;
    expect(body.features.inbox_routing).toBe(true);
    expect(body.features.team_hierarchy).toBe(true);
    // switching another add-on does not touch it either
    const other = buildPlanRequest(setAddonOffer(d, SEATS, 'hidden', PACKS), {
      addonPacks: PACKS,
    }).body!;
    expect(other.features.inbox_routing).toBe(true);
    // choosing Paid for it on purpose turns its features off, as the API stores
    const paid = buildPlanRequest(setAddonOffer(d, SMART, 'paid', PACKS), {
      addonPacks: PACKS,
    }).body!;
    expect(paid.features.inbox_routing).toBe(false);
  });

  it('without the pack list only the stored offers are sent back, and the features are left as drafted', () => {
    const d = planToDraft({
      ...stored,
      features: { ...stored.features, inbox_routing: true },
      addonOffers: [{ addonId: SEATS.id, mode: 'hidden', amount: null }],
    });
    const body = buildPlanRequest(d).body!;
    expect(body.addonOffers).toEqual([{ addonId: SEATS.id, mode: 'hidden', amount: null }]);
    expect(body.features.inbox_routing).toBe(true);
    expect(buildPlanRequest(filled()).body!.addonOffers).toEqual([]);
  });

  it('refuses a malformed or zero plan price on its own row', () => {
    const bad = buildPlanRequest(setAddonOfferAmount(filled(), SEATS.id, '1.2.3'), {
      addonPacks: PACKS,
    });
    expect(bad.problems?.[`addonOffers.${SEATS.id}`]).toEqual({ code: 'money' });
    const zero = buildPlanRequest(setAddonOfferAmount(filled(), SEATS.id, '0'), {
      addonPacks: PACKS,
    });
    expect(zero.problems?.[`addonOffers.${SEATS.id}`]).toEqual({ code: 'addonPriceZero' });
  });

  it('maps addonOffers.<i> errors to the add-on the request listed at <i>', () => {
    const ids = [SMART.id, SEATS.id];
    expect(planFieldForPath('addonOffers.1.mode', ids)).toBe(`addonOffers.${SEATS.id}`);
    expect(planFieldForPath('addonOffers.5.mode', ids)).toBe('addonOffers');
    expect(planFieldForPath('addonOffers')).toBe('addonOffers');
    expect(
      problemsFromServer(
        [
          { path: 'addonOffers.1.mode', message: 'Extra seat only adds to limits.' },
          { path: 'addonOffers.0.addonId', message: `unknown_addon:${SMART.id}` },
        ],
        { addonOfferIds: ids },
      ),
    ).toEqual({
      [`addonOffers.${SEATS.id}`]: { code: 'server', message: 'Extra seat only adds to limits.' },
      [`addonOffers.${SMART.id}`]: { code: 'addonGone' },
    });
  });

  it('locks every key a pack grants, naming the packs', () => {
    const locked = packLockedFeatures([SMART, OUTSIDE, SEATS]);
    expect(locked.get('inbox_routing')).toEqual(['Smart routing', 'Module pack']);
    expect(locked.get('inbox_assignment_sticky')).toEqual(['Smart routing']);
    expect(locked.has('users')).toBe(false);
    expect(locked.has('sales_pipeline')).toBe(false);
  });

  it('keys outside the catalogue are stored as module features', () => {
    expect(unlistedPackFeatures(OUTSIDE)).toEqual(['some_module_flag']);
    expect(unlistedPackFeatures(SMART)).toEqual([]);
    const on = setAddonOffer(filled(), OUTSIDE, 'included', [OUTSIDE]);
    const body = buildPlanRequest(on, { addonPacks: [OUTSIDE] }).body!;
    expect(body.moduleFeatures.some_module_flag).toBe(true);
    expect(body.features.inbox_routing).toBe(true);
  });

  it('counts the included feature add-ons, and the add-ons offered (Included + Paid, never Hidden)', () => {
    const d = setAddonOffer(
      setAddonOffer(filled({ visibleAddons: ['a', 'b'] }), SMART, 'included', PACKS),
      SEATS,
      'hidden',
      PACKS,
    );
    expect(includedPackCount(d, PACKS)).toBe(1);
    // Smart routing included, Teams paid (no row), Extra seat hidden; the mini apps are not counted here
    expect(packsOfferedCount(d, PACKS)).toBe(2);
    expect(packsOfferedCount(newPlanDraft(), [])).toBe(0);
  });

  it('the kind is the one stored on the pack, never worked out from its grants', () => {
    // Smart routing with no features yet: still a feature add-on (a grants-based kind would read capacity)
    const EMPTY_FEATURE = {
      id: 'e',
      kind: 'feature' as const,
      grants: { features: [], limits: { users: 1 } },
    };
    const CAPACITY = {
      id: 'c',
      kind: 'capacity' as const,
      grants: { features: [], limits: { users: 1 } },
    };
    expect(packKind(EMPTY_FEATURE)).toBe('feature');
    expect(packKind(CAPACITY)).toBe('capacity');
    // data that carries no kind falls back to the grants
    expect(packKind(SEATS)).toBe('capacity');
    expect(packKind(SMART)).toBe('feature');
    expect(offerModesFor(EMPTY_FEATURE)).toEqual(['included', 'paid', 'hidden']);
    expect(offerModesFor(CAPACITY)).toEqual(['paid', 'hidden']);
  });

  it('a feature add-on with no features cannot be included; one already included stays', () => {
    const EMPTY = { id: 'e', kind: 'feature' as const, grants: { features: [], limits: {} } };
    expect(canIncludePack(EMPTY)).toBe(false);
    expect(canIncludePack(SMART)).toBe(true);
    expect(canIncludePack({ kind: 'capacity', grants: { features: ['x'], limits: {} } })).toBe(
      false,
    );
    const d = filled();
    expect(setAddonOffer(d, EMPTY, 'included', [EMPTY])).toBe(d);
    expect(offerFor(setAddonOffer(d, EMPTY, 'hidden', [EMPTY]), 'e').mode).toBe('hidden');
    const was = filled({ addonOffers: { e: { mode: 'included', amount: '' } } });
    expect(setAddonOffer(was, EMPTY, 'included', [EMPTY]).addonOffers.e?.mode).toBe('included');
  });

  it('the draft is dirty after a mode change and clean again once it is put back', () => {
    const initial = { ...filled(), features: allOff() };
    const on = setAddonOffer(initial, SMART, 'included', PACKS);
    expect(isPlanDraftDirty(initial, on)).toBe(true);
    // back to paid at the add-on price = the same as no row
    expect(isPlanDraftDirty(initial, setAddonOffer(on, SMART, 'paid', PACKS))).toBe(false);
    expect(isPlanDraftDirty(initial, setAddonOfferAmount(initial, SMART.id, '5'))).toBe(true);
  });
});

describe('Marketplace app offers (Integrations and Mini apps tabs)', () => {
  const APP1 = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c2a01';
  const APP2 = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c2a02';
  const APP3 = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c2a03';
  const GONE = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c2aff';

  it('reads the mode from the offer row, else Paid when visible, else Hidden', () => {
    const d = filled({
      visibleAddons: [APP1, APP2],
      addonOffers: { [APP2]: { mode: 'included', amount: '' } },
    });
    expect(appModeFor(d, APP1)).toBe('paid');
    expect(appModeFor(d, APP2)).toBe('included');
    expect(appModeFor(d, APP3)).toBe('hidden');
    expect(appsOfferedCount(d, [APP1, APP2, APP3])).toBe(2);
  });

  it('setAppOffer keeps visibleAddons and the Included row in step', () => {
    const d = filled();
    const paid = setAppOffer(d, APP1, 'paid');
    expect(paid.visibleAddons).toEqual([APP1]);
    expect(paid.addonOffers).toEqual({});
    const inc = setAppOffer(paid, APP1, 'included');
    expect(inc.visibleAddons).toEqual([APP1]);
    expect(inc.addonOffers[APP1]).toEqual({ mode: 'included', amount: '' });
    const hidden = setAppOffer(inc, APP1, 'hidden');
    expect(hidden.visibleAddons).toEqual([]);
    expect(hidden.addonOffers).toEqual({});
    // an app's plan features are never touched
    expect(hidden.features).toEqual(d.features);
    const back = setAppOffer(inc, APP1, 'paid');
    expect(back.visibleAddons).toEqual([APP1]);
    expect(back.addonOffers[APP1]).toBeUndefined();
  });

  it('repairs a row that drifted: Included but not visible becomes visible, Hidden drops the row', () => {
    const drift = filled({ addonOffers: { [APP1]: { mode: 'included', amount: '' } } });
    expect(setAppOffer(drift, APP1, 'included').visibleAddons).toEqual([APP1]);
    expect(setAppOffer(drift, APP1, 'hidden').addonOffers).toEqual({});
  });

  it('returns the same draft when nothing would change', () => {
    const d = filled({
      visibleAddons: [APP1],
      addonOffers: { [APP2]: { mode: 'included', amount: '' } },
    });
    const withApp2Visible = { ...d, visibleAddons: [APP1, APP2] };
    expect(setAppOffer(withApp2Visible, APP1, 'paid')).toBe(withApp2Visible);
    expect(setAppOffer(withApp2Visible, APP2, 'included')).toBe(withApp2Visible);
    expect(setAppOffer(withApp2Visible, APP3, 'hidden')).toBe(withApp2Visible);
  });

  it('sets many at once', () => {
    const d = setAppOffers(filled(), [APP1, APP2], 'included');
    expect(d.visibleAddons).toEqual([APP1, APP2]);
    expect(Object.keys(d.addonOffers).sort()).toEqual([APP1, APP2]);
    expect(setAppOffers(d, [APP1, APP2], 'hidden').visibleAddons).toEqual([]);
  });

  it('the request carries one offer per listed app with amount null, and visibleAddons follows the modes', () => {
    const d = setAppOffer(
      setAppOffer(filled({ visibleAddons: [GONE] }), APP1, 'included'),
      APP2,
      'paid',
    );
    const body = buildPlanRequest(d, { appIds: [APP1, APP2, APP3] }).body!;
    expect(body.addonOffers).toEqual([
      { addonId: APP1, mode: 'included', amount: null },
      { addonId: APP2, mode: 'paid', amount: null },
      { addonId: APP3, mode: 'hidden', amount: null },
    ]);
    // the app ids are visible when Paid or Included; a stale id nobody lists is left alone
    expect([...body.visibleAddons!].sort()).toEqual([APP1, APP2, GONE].sort());
    expect(createPlanRequestSchema.safeParse(body).success).toBe(true);
  });

  it('plain add-on offers are sent exactly as before next to the app offers', () => {
    const PACK = {
      id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e01',
      grants: { features: ['inbox_routing'], limits: {} },
    };
    const d = setAppOffer(setAddonOffer(filled(), PACK, 'hidden', [PACK]), APP1, 'paid');
    const ids = buildPlanRequest(d, { appIds: [APP1], addonPacks: [PACK] }).body!.addonOffers!.map(
      (o: { addonId: string }) => o.addonId,
    );
    expect(ids).toEqual([PACK.id, APP1]);
  });

  it('without the app list, stored Included app rows are sent back as they are and visibleAddons is unchanged', () => {
    const d = filled({
      visibleAddons: [APP1, APP2],
      addonOffers: { [APP2]: { mode: 'included', amount: '' } },
    });
    const body = buildPlanRequest(d).body!;
    expect(body.addonOffers).toEqual([{ addonId: APP2, mode: 'included', amount: null }]);
    expect(body.visibleAddons).toEqual([APP1, APP2]);
  });

  it('an untouched stored plan is unchanged, and putting a mode back is not a change either', () => {
    const base = planToDraft({
      ...stored,
      visibleAddons: [APP1, APP2],
      addonOffers: [{ addonId: APP2, mode: 'included', amount: null }],
    });
    expect(appModeFor(base, APP1)).toBe('paid');
    expect(appModeFor(base, APP2)).toBe('included');
    expect(isPlanDraftDirty(base, base)).toBe(false);
    expect(isPlanDraftDirty(base, setAppOffer(base, APP1, 'paid'))).toBe(false);
    const edited = setAppOffer(base, APP1, 'hidden');
    expect(isPlanDraftDirty(base, edited)).toBe(true);
    expect(isPlanDraftDirty(base, setAppOffer(edited, APP1, 'paid'))).toBe(false);
    expect(isPlanDraftDirty(base, setAppOffer(base, APP2, 'paid'))).toBe(true);
  });

  it('maps an error on an app offer to the app the request listed at that position', () => {
    const body = buildPlanRequest(setAppOffer(filled(), APP1, 'included'), {
      appIds: [APP1],
    }).body!;
    const ids = body.addonOffers!.map((o: { addonId: string }) => o.addonId);
    const p = problemsFromServer([{ path: 'addonOffers.0', message: `unknown_addon:${APP1}` }], {
      addonOfferIds: ids,
    });
    expect(p[`addonOffers.${APP1}`]?.code).toBe('addonGone');
  });
});
