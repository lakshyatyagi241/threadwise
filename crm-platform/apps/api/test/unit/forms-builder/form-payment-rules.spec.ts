import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinitionInput } from '@crm/contracts';
import {
  computeAmount,
  formPaymentReference,
  paymentUuidFromReference,
} from '../../../src/modules/forms-builder/form-payment-rules';

const field = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  required: true,
  ...over,
});
const make = (blocks: unknown[], payment: Record<string, unknown>) =>
  formDefinitionSchema.parse({
    title: 'T',
    steps: [{ id: 'step', blocks }],
    payment,
  } as FormDefinitionInput);

describe('computeAmount (spec 10.2: the server decides the amount)', () => {
  it('a form with payment off charges nothing', () => {
    const d = make([field('a', 'short_text')], {});
    expect(computeAmount(d, {})).toEqual({ ok: false, reason: 'payment_off' });
  });

  it('fixed: the price in the frozen version, whatever the browser sent', () => {
    const d = make([field('a', 'short_text')], { enabled: true, amountMinor: 50_000 });
    expect(computeAmount(d, { a: 'x', amount: 1 })).toEqual({
      ok: true,
      amountMinor: 50_000n,
      currency: 'INR',
    });
  });

  it('from a field: the chosen option carries the price; an unknown option charges nothing', () => {
    const d = make(
      [
        field('plan', 'dropdown', {
          options: [
            { value: 'a', label: 'A', amountMinor: 50_000 },
            { value: 'b', label: 'B', amountMinor: 90_000 },
          ],
        }),
      ],
      { enabled: true, amountType: 'from_field', fieldId: 'plan' },
    );
    expect(computeAmount(d, { plan: 'b' })).toMatchObject({ ok: true, amountMinor: 90_000n });
    expect(computeAmount(d, { plan: 'zzz' })).toEqual({ ok: false, reason: 'amount_unknown' });
    expect(computeAmount(d, {})).toEqual({ ok: false, reason: 'amount_unknown' });
  });

  it('pay what you want: major units become exact minor units inside the limits', () => {
    const d = make([field('gift', 'currency')], {
      enabled: true,
      amountType: 'pay_what_you_want',
      fieldId: 'gift',
      minMinor: 10_000,
      maxMinor: 100_000,
    });
    expect(computeAmount(d, { gift: 250.5 })).toMatchObject({ ok: true, amountMinor: 25_050n });
    expect(computeAmount(d, { gift: 99.99 })).toMatchObject({
      ok: false,
      reason: 'amount_out_of_range',
    });
    expect(computeAmount(d, { gift: 1000.01 })).toMatchObject({
      ok: false,
      reason: 'amount_out_of_range',
    });
    expect(computeAmount(d, { gift: -5 })).toMatchObject({ ok: false, reason: 'amount_unknown' });
    expect(computeAmount(d, { gift: 'ten' })).toMatchObject({
      ok: false,
      reason: 'amount_unknown',
    });
  });

  it('a zero-decimal currency keeps whole units', () => {
    const d = make([field('gift', 'number')], {
      enabled: true,
      amountType: 'pay_what_you_want',
      fieldId: 'gift',
      minMinor: 100,
      currency: 'JPY',
    });
    expect(computeAmount(d, { gift: 1500 })).toMatchObject({
      ok: true,
      amountMinor: 1500n,
      currency: 'JPY',
    });
  });
});

describe('payment definition rules', () => {
  const bad = (blocks: unknown[], payment: Record<string, unknown>) =>
    formDefinitionSchema.safeParse({
      title: 'T',
      steps: [{ id: 'step', blocks }],
      payment,
    } as FormDefinitionInput);
  const messages = (r: ReturnType<typeof bad>) =>
    r.success ? [] : r.error.issues.map((i) => i.message);

  it('fixed needs an amount', () => {
    expect(messages(bad([field('a', 'short_text')], { enabled: true }))).toContain(
      'payment_amount_required',
    );
  });
  it('from_field needs a required choice whose options all carry an amount', () => {
    const noAmounts = field('p', 'dropdown', { options: [{ value: 'a', label: 'A' }] });
    expect(
      messages(bad([noAmounts], { enabled: true, amountType: 'from_field', fieldId: 'p' })),
    ).toContain('payment_options_need_amounts');
    expect(
      messages(
        bad([field('p', 'short_text')], { enabled: true, amountType: 'from_field', fieldId: 'p' }),
      ),
    ).toContain('payment_field_must_be_choice');
  });
  it('pay_what_you_want needs a required number field and a minimum', () => {
    expect(
      messages(
        bad([field('g', 'currency', { required: false })], {
          enabled: true,
          amountType: 'pay_what_you_want',
          fieldId: 'g',
          minMinor: 100,
        }),
      ),
    ).toContain('payment_field_must_be_required');
    expect(
      messages(
        bad([field('g', 'currency')], {
          enabled: true,
          amountType: 'pay_what_you_want',
          fieldId: 'g',
        }),
      ),
    ).toContain('payment_min_required');
  });
  it('a disabled payment block is never checked', () => {
    expect(
      bad([field('a', 'short_text')], { enabled: false, amountType: 'from_field' }).success,
    ).toBe(true);
  });
});

describe('the FRM- reference', () => {
  it('round-trips a payment uuid and rejects anything else', () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    expect(paymentUuidFromReference(formPaymentReference(uuid))).toBe(uuid);
    expect(paymentUuidFromReference('INV-' + uuid)).toBeNull();
    expect(paymentUuidFromReference('FRM-not-a-uuid')).toBeNull();
  });
});
