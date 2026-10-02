import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS, type PlanAdminItem } from '@crm/contracts';
import { createPlanRequestSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildPlanRequest,
  isPlanDraftDirty,
  newPlanDraft,
  planFieldForPath,
  planToDraft,
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
  limits: {
    monthly_messages: 10000,
    broadcasts: 0,
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
    inbox_sla: false,
    inbox_routing: true,
    inbox_kanban: true,
    team_performance: true,
  },
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
