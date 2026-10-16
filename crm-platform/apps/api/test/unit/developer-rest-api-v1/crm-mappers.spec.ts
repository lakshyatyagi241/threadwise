import { describe, expect, it } from 'vitest';
import {
  v1CreateContactSchema,
  v1CreateDealSchema,
  v1UpdateContactSchema,
  v1UpdateDealSchema,
  type BillingUsageResponse,
  type ContactResponse,
  type DealResponse,
} from '@crm/contracts';
import {
  toMe,
  toUsage,
  V1_METERS,
} from '../../../src/modules/developer-rest-api-v1/resources/crm/account/account.mapper';
import {
  toE164,
  toV1Contact,
} from '../../../src/modules/developer-rest-api-v1/resources/crm/contacts/contacts.mapper';
import { toV1Deal } from '../../../src/modules/developer-rest-api-v1/resources/crm/deals/deals.mapper';
import {
  has,
  isUuid,
  uuidOrNotFound,
} from '../../../src/modules/developer-rest-api-v1/resources/crm/v1-ids';

const usage = (over: Partial<BillingUsageResponse> = {}): BillingUsageResponse => ({
  planSlug: 'pro',
  planName: 'Pro',
  validity: {
    state: 'paid_active',
    trialEndsAt: null,
    planEndsAt: '2026-12-01T00:00:00.000Z',
    daysLeft: 40,
    renewalWindow: false,
    graceEndsAt: null,
  },
  meters: [
    { key: 'monthly_messages', used: 40, limit: 100, percent: 40, window: 'month' },
    { key: 'contacts', used: 3, limit: 0, percent: null, window: 'total' },
  ],
  features: [
    { key: 'sales_pipeline', enabled: true },
    { key: 'public_api', enabled: false },
  ],
  cycleResetsAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

describe('account mapper (TW-API-020, 021)', () => {
  it('shows an uncapped meter as null and lists only the unlocked features', () => {
    const me = toMe({
      user: { name: 'Ann', email: 'a@x.test' },
      org: {
        uuid: '11111111-1111-4111-8111-111111111111',
        name: 'Acme',
        slug: 'acme',
        settings: { timezone: 'Asia/Kolkata', currency: 'INR' },
      },
      planIsFree: false,
      usage: usage(),
    });
    expect(me.limits).toEqual({
      monthly_messages_limit: 100,
      contacts_limit: null,
      device_limit: null,
      user_seat_limit: null,
      flow_limit: null,
    });
    expect(me.features).toEqual({ sales_pipeline: true });
    expect(me.workspace).toMatchObject({ timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(me.plan).toEqual({ id: 'pro', name: 'Pro', is_free: false });
  });

  it('settings without a timezone or currency give null, not a guess', () => {
    const me = toMe({
      user: { name: null, email: null },
      org: { uuid: 'u', name: 'n', slug: 's', settings: {} },
      planIsFree: true,
      usage: usage(),
    });
    expect(me.workspace).toMatchObject({ timezone: null, currency: null });
  });

  it('counts 40 of 100 messages as 60 remaining and 40 percent, with credits as a minor-unit string', () => {
    const out = toUsage(
      usage(),
      { balanceMinor: 1250, currency: 'USD' },
      new Date('2026-10-20T12:00:00Z'),
    );
    expect(out.messages).toEqual({
      used: 40,
      limit: 100,
      unlimited: false,
      remaining: 60,
      percent: 40,
    });
    expect(out.period).toEqual({
      label: 'October 2026',
      resets_on: '2026-11-01T00:00:00.000Z',
      days_left: 12,
    });
    expect(out.plan).toEqual({
      name: 'Pro',
      valid_until: '2026-12-01T00:00:00.000Z',
      valid_until_days: 40,
    });
    expect(out.credits).toBe('1250');
    expect(out.meters.contacts_limit).toEqual({
      label: 'Contacts',
      used: 3,
      limit: null,
      unlimited: true,
      percent: null,
    });
  });

  it('an unlimited message plan has no limit and no remaining', () => {
    const out = toUsage(
      usage({
        meters: [{ key: 'monthly_messages', used: 5, limit: 0, percent: null, window: 'month' }],
      }),
      { balanceMinor: 0, currency: 'USD' },
    );
    expect(out.messages).toEqual({
      used: 5,
      limit: null,
      unlimited: true,
      remaining: null,
      percent: null,
    });
  });

  it("exposes Reference's five meters under its key names and labels, and nothing else (TW-API-020, 021)", () => {
    const extra = [
      ...usage().meters,
      { key: 'api_keys', used: 1, limit: 3, percent: 33, window: 'total' as const },
      { key: 'flows', used: 2, limit: 5, percent: 40, window: 'total' as const },
    ];
    const out = toUsage(usage({ meters: extra }), { balanceMinor: 0, currency: 'USD' });
    expect(Object.keys(out.meters)).toEqual([
      'monthly_messages_limit',
      'contacts_limit',
      'device_limit',
      'user_seat_limit',
      'flow_limit',
    ]);
    expect(Object.values(out.meters).map((m) => m.label)).toEqual([
      'Messages this month',
      'Contacts',
      'Connected numbers',
      'Team seats',
      'Flows',
    ]);
    expect(out.meters.flow_limit).toMatchObject({ used: 2, limit: 5, unlimited: false });
    expect(out.meters.device_limit).toMatchObject({ used: 0, limit: null, unlimited: true });
    expect(V1_METERS.map((m) => m.ours)).toEqual([
      'monthly_messages',
      'contacts',
      'devices',
      'users',
      'flows',
    ]);
    const me = toMe({
      user: { name: null, email: null },
      org: { uuid: 'u', name: 'n', slug: 's', settings: {} },
      planIsFree: true,
      usage: usage({ meters: extra }),
    });
    expect(Object.keys(me.limits)).toEqual(Object.keys(out.meters));
    expect(me.limits.flow_limit).toBe(5);
  });
});

describe('contact mapper and schemas (TW-API-022 to 025)', () => {
  it('normalizes a stored number to a plus and digits, and an empty one to null', () => {
    expect(toE164('+91 98123-45678')).toBe('+919812345678');
    expect(toE164('0044 20')).toBe('+004420');
    expect(toE164('  ')).toBeNull();
    expect(toE164(null)).toBeNull();
  });

  it('shows groups as tags with id and name only, and custom fields as attributes', () => {
    const c = {
      id: 'c1',
      name: 'N',
      phone: '+1 555',
      email: null,
      customFields: { a: 1 },
      timezone: 'Asia/Kolkata',
      timezoneSource: 'api',
      createdAt: '2026-01-01T00:00:00.000Z',
      groups: [{ id: 'g1', name: 'G', color: '#000000' }],
    } as unknown as ContactResponse;
    expect(toV1Contact(c)).toEqual({
      id: 'c1',
      name: 'N',
      phone: '+1555',
      email: null,
      tags: [{ id: 'g1', name: 'G' }],
      attributes: { a: 1 },
      // BL-193: the contact's own time zone and who set it (a product extension on Reference's contact).
      timezone: 'Asia/Kolkata',
      timezone_source: 'api',
      created_at: '2026-01-01T00:00:00.000Z',
      is_minor: false,
    });
  });

  it('create needs a phone and either name or first_name; empty strings count as missing', () => {
    expect(v1CreateContactSchema.safeParse({ phone: '1' }).success).toBe(false);
    expect(v1CreateContactSchema.safeParse({ name: ' ', phone: '1' }).success).toBe(false);
    expect(v1CreateContactSchema.safeParse({ name: 'A' }).success).toBe(false);
    expect(v1CreateContactSchema.safeParse({ first_name: 'A', phone: '1' }).success).toBe(true);
    expect(v1CreateContactSchema.safeParse({ name: 'A', phone: 'x'.repeat(33) }).success).toBe(
      false,
    );
    expect(
      v1CreateContactSchema.safeParse({ name: 'A', phone: '1', title: 't'.repeat(51) }).success,
    ).toBe(false);
    expect(
      v1CreateContactSchema.safeParse({ name: 'A', phone: '1', note: 'n'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('accepts the boolean spellings Laravel does for is_unsubscribed', () => {
    for (const [input, out] of [
      [true, true],
      [0, false],
      ['1', true],
      ['false', false],
    ] as const) {
      expect(v1UpdateContactSchema.parse({ is_unsubscribed: input }).is_unsubscribed).toBe(out);
    }
    expect(v1UpdateContactSchema.safeParse({ is_unsubscribed: 'maybe' }).success).toBe(false);
  });

  it('update takes an empty body and a null that clears', () => {
    expect(v1UpdateContactSchema.safeParse({}).success).toBe(true);
    expect(v1UpdateContactSchema.parse({ email: null }).email).toBeNull();
  });
});

describe('deal mapper and schemas (TW-API-048 to 051)', () => {
  const dto = (over: Partial<DealResponse> = {}): DealResponse =>
    ({
      id: 'd1',
      title: 'T',
      pipeline: { id: 'p1', name: 'P' },
      stage: { id: 's1', name: 'New Lead', color: '#fff', probability: 10, kind: 'open' },
      status: 'open',
      value: '12.50',
      currency: 'USD',
      owner: null,
      contact: { id: 'c1', name: 'x', phone: null, email: null },
      company: null,
      expectedCloseDate: '2026-12-31',
      source: 'api',
      lostReason: null,
      lostReasonId: null,
      notes: null,
      wonAt: null,
      lostAt: null,
      rowVersion: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...over,
    }) as DealResponse;

  it('flattens to ids, major value and integer minor value', () => {
    expect(toV1Deal(dto())).toEqual({
      id: 'd1',
      title: 'T',
      pipeline_id: 'p1',
      stage_id: 's1',
      stage: 'New Lead',
      status: 'open',
      value: 12.5,
      value_minor: 1250,
      currency: 'USD',
      contact_id: 'c1',
      owner_user_id: null,
      source: 'api',
      expected_close_date: '2026-12-31',
      lost_reason: null,
      won_at: null,
      lost_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    });
    expect(toV1Deal(dto({ value: '100.00' })).value).toBe(100);
  });

  it('create: title required up to 191, value 0 to 99999999 as a number or numeric string', () => {
    expect(v1CreateDealSchema.safeParse({}).success).toBe(false);
    expect(v1CreateDealSchema.safeParse({ title: 't'.repeat(192) }).success).toBe(false);
    expect(v1CreateDealSchema.safeParse({ title: 'x', value: -1 }).success).toBe(false);
    expect(v1CreateDealSchema.safeParse({ title: 'x', value: 100000000 }).success).toBe(false);
    expect(v1CreateDealSchema.parse({ title: 'x', value: 12.5 }).value).toBe('12.5');
    expect(v1CreateDealSchema.parse({ title: 'x', value: '3' }).value).toBe('3');
    expect(v1CreateDealSchema.parse({ title: 'x', contact_id: 999999 }).contact_id).toBe('999999');
    expect(
      v1CreateDealSchema.safeParse({ title: 'x', expected_close_date: 'not a date' }).success,
    ).toBe(false);
  });

  it('update: every key optional, a null value is allowed, an empty title is not', () => {
    expect(v1UpdateDealSchema.safeParse({}).success).toBe(true);
    expect(v1UpdateDealSchema.parse({ value: null }).value).toBeNull();
    expect(v1UpdateDealSchema.safeParse({ title: '' }).success).toBe(false);
    expect(v1UpdateDealSchema.safeParse({ lost_reason: 'r'.repeat(192) }).success).toBe(false);
  });
});

describe('id helpers', () => {
  it('only a uuid can match a row; anything else is a 404, and a key sent as null still counts as sent', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(isUuid('12')).toBe(false);
    expect(() => uuidOrNotFound('12', 'Deal')).toThrow(/not found/);
    expect(uuidOrNotFound('AAAAAAAA-0000-4000-8000-000000000000', 'Deal')).toBe(
      'aaaaaaaa-0000-4000-8000-000000000000',
    );
    expect(has({ a: null }, 'a')).toBe(true);
    expect(has({}, 'a')).toBe(false);
    expect(has(null, 'a')).toBe(false);
  });
});
