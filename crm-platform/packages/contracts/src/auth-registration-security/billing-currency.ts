/**
 * The currency a new workspace is billed in, chosen during onboarding together with its country and timezone.
 *
 * The rule: a workspace in India is billed in INR, a workspace anywhere else in USD. The owner can choose differently among the
 * currencies the platform can really bill in (those whose Meta rate card is stored); this is only the pre-selected answer. When the
 * rule's currency is not one the platform can bill in, the platform currency is used instead, so a fresh install with no INR card
 * never offers a default it cannot honour.
 */
export const INDIA = 'IN';
export const INDIA_BILLING_CURRENCY = 'INR';
export const DEFAULT_BILLING_CURRENCY = 'USD';

/** Billing currency suggested for a country. `available` are the currencies the platform can bill in; `platformCurrency` is the fallback. */
export function defaultBillingCurrency(
  country: string | null | undefined,
  available: readonly string[],
  platformCurrency: string,
): string {
  const wanted =
    (country ?? '').trim().toUpperCase() === INDIA
      ? INDIA_BILLING_CURRENCY
      : DEFAULT_BILLING_CURRENCY;
  return available.includes(wanted) ? wanted : platformCurrency;
}
