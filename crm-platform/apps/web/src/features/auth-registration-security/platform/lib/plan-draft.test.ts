import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS, type PlanAdminItem } from '@crm/contracts';
import { createPlanRequestSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildPlanRequest,
  clearAddons,
  countFeaturesOn,
  countLimitsSet,
  isPlanDraftDirty,
  limitIsUnlimited,
  newPlanDraft,
  planFieldForPath,
  planToDraft,
  problemsFromServer,
  selectAddons,
  setLimitUnlimited,
  toggleAddon,
  toggleFeatures,
  unknownAddonId,
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
    chatbot_widgets: false,
    wa_storefront: false,
    inbox_sla: false,
    inbox_routing: true,
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
  it("starts the way WaDesk's wizard does: active, every feature on, every limit blank", () => {
    const d = newPlanDraft();
    expect(d.isActive).toBe(true);
    expect(Object.values(d.features).every(Boolean)).toBe(true);
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

  it('the offer must be lower than the price (WD-PLAN-003)', () => {
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
    expect(countFeaturesOn(newPlanDraft().features)).toBe(PLAN_FEATURE_KEYS.length);
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

describe('module-contributed plan keys (WD-ADD-013)', () => {
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
