import { describe, expect, it } from 'vitest';
import { formDefinitionSchema } from '@crm/contracts';
import {
  formatMinor,
  paymentIssue,
  paymentOf,
  previewAmount,
  toMajorText,
  toMinor,
} from './payment';
import type { RenderableForm } from './types';

const field = (id: string, kind: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'field',
  kind,
  label: id,
  required: true,
  ...over,
});
const def = (blocks: unknown[], payment: Record<string, unknown>) =>
  formDefinitionSchema.parse({ title: 'T', steps: [{ id: 's', blocks }], payment });

describe('money text', () => {
  it('reads a typed price as exact minor units', () => {
    expect(toMinor('499', 'INR')).toBe(49_900);
    expect(toMinor('499.50', 'INR')).toBe(49_950);
    expect(toMinor('1,299.00', 'INR')).toBe(129_900);
    expect(toMinor('1500', 'JPY')).toBe(1500);
  });
  it('refuses what is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '0', '0.00', '1.234', '1e3'])
      expect(toMinor(bad, 'INR')).toBeNull();
    expect(toMinor('10.5', 'JPY')).toBeNull();
  });
  it('writes minor units back as text and as a formatted amount', () => {
    expect(toMajorText(49_900, 'INR')).toBe('499.00');
    expect(toMajorText(undefined, 'INR')).toBe('');
    expect(formatMinor(49_900, 'INR', 'en-IN')).toContain('499.00');
  });
});

describe('paymentIssue', () => {
  it('is null when payment is off', () => {
    expect(paymentIssue(def([field('a', 'short_text')], {}))).toBeNull();
  });
  it('asks for the price of a fixed form (a draft may be half done; the contract refuses to publish it)', () => {
    const draft = {
      ...def([field('a', 'short_text')], {}),
      payment: { enabled: true, amountType: 'fixed' as const, currency: 'INR' },
    };
    expect(paymentIssue(draft)).toBe('amountRequired');
    expect(
      paymentIssue(def([field('a', 'short_text')], { enabled: true, amountMinor: 100 })),
    ).toBeNull();
  });
});

describe('what the visitor is shown', () => {
  const choice = def(
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
  const form = choice as unknown as RenderableForm;

  it('follows the chosen option, and is unknown before a choice', () => {
    expect(previewAmount(form, {})).toBeNull();
    expect(previewAmount(form, { plan: 'b' })).toBe(90_000);
  });
  it('is nothing for a form without payment', () => {
    expect(paymentOf(def([field('a', 'short_text')], {}) as unknown as RenderableForm)).toBeNull();
  });
  it('pay what you want reads the typed amount', () => {
    const pwyw = def([field('g', 'currency')], {
      enabled: true,
      amountType: 'pay_what_you_want',
      fieldId: 'g',
      minMinor: 100,
    }) as unknown as RenderableForm;
    expect(previewAmount(pwyw, { g: '250.50' })).toBe(25_050);
    expect(previewAmount(pwyw, { g: 'x' })).toBeNull();
  });
});
