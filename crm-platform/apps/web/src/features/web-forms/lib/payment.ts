import { currencyExponent, majorToMinor, minorToMajor, type PublicForm } from '@crm/contracts';
import type { Answers, Definition, RenderableForm } from './types';

/**
 * Money on a form (docs/specs/forms-builder-app.md section 10), in the browser. These helpers only DISPLAY and PRE-CHECK: the server
 * computes the amount that is charged from the frozen version and the validated answers, and never reads a number from here.
 */

/** "499.00" typed by a person -> minor units (49900), or null when it is not an amount this currency can hold. */
export function toMinor(text: string, currency: string): number | null {
  const t = text.trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d+)?$/.test(t)) return null;
  const minor = majorToMinor(t, currency);
  if (minor === null || minor <= 0n || minor > 1_000_000_000n) return null;
  return Number(minor);
}

/** Minor units -> the text a person types ("49900" INR -> "499.00"). */
export function toMajorText(minor: number | undefined, currency: string): string {
  return minor === undefined ? '' : minorToMajor(BigInt(minor), currency);
}

/** "₹499.00" in the viewer's language; falls back to "499.00 INR" for a currency the browser does not know. */
export function formatMinor(minor: number | bigint, currency: string, locale?: string): string {
  const major = minorToMajor(typeof minor === 'bigint' ? minor : BigInt(minor), currency);
  const digits = currencyExponent(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(major));
  } catch {
    return `${major} ${currency}`;
  }
}

export type PaymentIssue =
  | 'amountRequired'
  | 'fieldRequired'
  | 'fieldNotRequired'
  | 'optionsNeedAmounts'
  | 'minRequired'
  | 'minAboveMax';

/** What is wrong with the payment block of the draft (null when it is fine or off). Mirrors the contract's own rules so the person is told here. */
export function paymentIssue(def: Definition): PaymentIssue | null {
  const p = def.payment;
  if (!p.enabled) return null;
  const field = def.steps
    .flatMap((s) => s.blocks)
    .find((b) => b.type === 'field' && b.id === p.fieldId);
  if (p.amountType === 'fixed') return p.amountMinor === undefined ? 'amountRequired' : null;
  if (!field || field.type !== 'field') return 'fieldRequired';
  if (!field.required) return 'fieldNotRequired';
  if (p.amountType === 'from_field') {
    return (field.options ?? []).length === 0 ||
      (field.options ?? []).some((o) => o.amountMinor === undefined)
      ? 'optionsNeedAmounts'
      : null;
  }
  if (p.minMinor === undefined) return 'minRequired';
  return p.maxMinor !== undefined && p.minMinor > p.maxMinor ? 'minAboveMax' : null;
}

/** The fields a payment can read its amount from: a required dropdown or radio (from a field), a required number or currency (pay what you want). */
export function paymentFieldChoices(
  def: Definition,
  type: 'from_field' | 'pay_what_you_want',
): Array<{ id: string; label: string }> {
  const kinds = type === 'from_field' ? ['dropdown', 'radio'] : ['number', 'currency'];
  return def.steps
    .flatMap((s) => s.blocks)
    .flatMap((b) =>
      b.type === 'field' && kinds.includes(b.kind) ? [{ id: b.id, label: b.label }] : [],
    );
}

/**
 * What the visitor will be asked to pay, from the answers so far: a number in minor units, or null while it is not known yet (no choice
 * made, nothing typed). Display only.
 */
export function previewAmount(form: RenderableForm, answers: Answers): number | null {
  const p = paymentOf(form);
  if (!p) return null;
  if (p.amountType === 'fixed') return p.amountMinor ?? null;
  const field = form.steps
    .flatMap((s) => s.blocks)
    .find((b) => b.type === 'field' && b.id === p.fieldId);
  if (!field || field.type !== 'field') return null;
  const a = answers[field.id];
  if (p.amountType === 'from_field') {
    return field.options?.find((o) => o.value === a)?.amountMinor ?? null;
  }
  return typeof a === 'string' ? toMinor(a, p.currency) : null;
}

/** The payment a renderer shows: the public summary as it is, or the draft's block when it is switched on (builder preview). */
export function paymentOf(form: RenderableForm): PublicForm['payment'] {
  const p = form.payment;
  if (!p) return null;
  if ('enabled' in p && !p.enabled) return null;
  return {
    amountType: p.amountType,
    amountMinor: p.amountMinor,
    fieldId: p.fieldId,
    minMinor: p.minMinor,
    maxMinor: p.maxMinor,
    currency: p.currency,
    description: p.description,
  };
}
