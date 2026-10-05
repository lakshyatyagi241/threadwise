/** The reference our store orders carry at every payment gateway (`WAORD-<order number>`): Razorpay's `reference_id`, a driver's `orderNumber`. */
export const ORDER_REFERENCE_PREFIX = 'WAORD-';

export const orderReference = (orderNo: number): string => `${ORDER_REFERENCE_PREFIX}${orderNo}`;

/** The order number inside a reference, or null when it is not one of ours. */
export function orderNoFromReference(reference: string): number | null {
  const m = /^WAORD-(\d{1,15})$/.exec(reference.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The provider's own account of the payment against the order (WaDesk checked nothing here; the platform's billing receiver does):
 * what it says it collected must equal the order total and currency. A provider that states neither is taken on its verified
 * signature alone.
 */
export function paymentMatchesOrder(
  order: { totalMinor: number; currencyCode: string },
  payment: { amountMinor?: bigint; currency?: string },
): boolean {
  if (payment.amountMinor === undefined && payment.currency === undefined) return true;
  const amountOk =
    payment.amountMinor === undefined || payment.amountMinor === BigInt(order.totalMinor);
  const currencyOk =
    payment.currency === undefined ||
    payment.currency.toUpperCase() === (order.currencyCode || 'INR').toUpperCase();
  return amountOk && currencyOk;
}
