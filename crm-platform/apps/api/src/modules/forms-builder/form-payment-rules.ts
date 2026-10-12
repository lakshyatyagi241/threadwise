import { currencyExponent, formFields, majorToMinor, type FormDefinition } from '@crm/contracts';
import type { StoredAnswer } from './form-rules';

/**
 * Payment rules of a form (docs/specs/forms-builder-app.md section 10), pure: no database, no clock, no gateway.
 *
 * The SERVER decides what is charged: from the frozen version's payment block and the visitor's VALIDATED answers. Nothing the browser
 * sends as an "amount" is read anywhere; a visitor cannot pay 1 for a 500 item.
 */

/** The reference an attempt carries at the shared gateway: `FRM-<payment uuid>`. The prefix routes the verified notification to the form settler. */
export const FORM_PAYMENT_REFERENCE_PREFIX = 'FRM-';
export const formPaymentReference = (paymentUuid: string): string =>
  `${FORM_PAYMENT_REFERENCE_PREFIX}${paymentUuid}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The payment uuid inside a reference, or null when it is not one of ours. */
export function paymentUuidFromReference(reference: string): string | null {
  if (!reference.startsWith(FORM_PAYMENT_REFERENCE_PREFIX)) return null;
  const id = reference.slice(FORM_PAYMENT_REFERENCE_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/** How long a payment link stays open before the worker marks the attempt expired. */
export const FORM_PAYMENT_TTL_HOURS = 48;

export type AmountResult =
  | { ok: true; amountMinor: bigint; currency: string }
  | { ok: false; reason: 'payment_off' | 'amount_unknown' | 'amount_out_of_range' };

/** What this submission must pay. `ok:false` for a form with payment off, or an answer that does not name a priced option or a legal amount. */
export function computeAmount(
  def: FormDefinition,
  values: Record<string, StoredAnswer>,
): AmountResult {
  const p = def.payment;
  if (!p.enabled) return { ok: false, reason: 'payment_off' };
  const currency = p.currency;

  if (p.amountType === 'fixed') {
    return p.amountMinor
      ? { ok: true, amountMinor: BigInt(p.amountMinor), currency }
      : { ok: false, reason: 'amount_unknown' };
  }

  const field = formFields(def).find((f) => f.id === p.fieldId);
  if (!field) return { ok: false, reason: 'amount_unknown' };
  const answer = values[field.id];

  if (p.amountType === 'from_field') {
    const option = field.options?.find((o) => o.value === answer);
    return option?.amountMinor
      ? { ok: true, amountMinor: BigInt(option.amountMinor), currency }
      : { ok: false, reason: 'amount_unknown' };
  }

  // pay_what_you_want: the answer is a number in MAJOR units; it becomes minor units exactly (no float arithmetic).
  if (typeof answer !== 'number' || !Number.isFinite(answer) || answer <= 0) {
    return { ok: false, reason: 'amount_unknown' };
  }
  const minor = majorToMinor(answer.toFixed(currencyExponent(currency)), currency);
  if (minor === null || minor <= 0n) return { ok: false, reason: 'amount_unknown' };
  if (p.minMinor !== undefined && minor < BigInt(p.minMinor)) {
    return { ok: false, reason: 'amount_out_of_range' };
  }
  if (p.maxMinor !== undefined && minor > BigInt(p.maxMinor)) {
    return { ok: false, reason: 'amount_out_of_range' };
  }
  return { ok: true, amountMinor: minor, currency };
}
