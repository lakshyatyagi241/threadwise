import type { PaygwOrderItem } from '@crm/contracts';
import { majorToMinor, minorToMajor } from './order-pricing';
import type { OrderRow } from './orders.repository';

/** '46.0200' (numeric(12,4)) -> '46.02' in the currency's own exponent. */
export function trimMoney(value: string, currency: string): string {
  const minor = majorToMinor(value, currency);
  return minor === null ? value : minorToMajor(minor, currency);
}

/** The only place an order row becomes a response: uuid out, internal ids and provider payloads never. */
export function toOrderResponse(
  o: OrderRow & { gatewayName: string | null; planName: string | null },
): PaygwOrderItem {
  return {
    id: o.uuid,
    orderNumber: o.orderNumber,
    kind: o.kind,
    itemName: o.kind === 'wallet_topup' ? 'Wallet top-up' : (o.planName ?? o.planSlug ?? 'Plan'),
    status: o.status,
    billingPeriod: o.billingPeriod,
    currency: o.currency,
    amount: trimMoney(o.totalAmount, o.currency),
    discountAmount: trimMoney(o.discountAmount, o.currency),
    taxAmount: trimMoney(o.taxAmount, o.currency),
    couponCode: o.couponCode,
    gatewayName: o.gatewayName,
    failureReason: o.failureReason,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  };
}
