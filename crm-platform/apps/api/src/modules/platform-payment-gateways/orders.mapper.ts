import type { PaygwOrderItem } from '@crm/contracts';
import { gatewayMeta } from '../../infra/providers/platform-payment-gateways';
import { majorToMinor, minorToMajor } from './order-pricing';
import { MANUAL_GATEWAYS } from './gateway-rules';
import type { OrderRow } from './orders.repository';

/** '46.0200' (numeric(12,4)) -> '46.02' in the currency's own exponent. */
export function trimMoney(value: string, currency: string): string {
  const minor = majorToMinor(value, currency);
  return minor === null ? value : minorToMajor(minor, currency);
}

/** The only place an order row becomes a response: uuid out, internal ids and provider payloads never. */
export function toOrderResponse(o: OrderRow & { planName: string | null }): PaygwOrderItem {
  return {
    id: o.uuid,
    orderNumber: o.orderNumber,
    kind: o.kind,
    itemName:
      o.kind === 'wallet_topup'
        ? 'Wallet top-up'
        : o.kind === 'manual'
          ? (o.description ?? 'Invoice')
          : (o.planName ?? o.planSlug ?? 'Plan'),
    status: o.status,
    billingPeriod: o.billingPeriod,
    currency: o.currency,
    amount: trimMoney(o.totalAmount, o.currency),
    discountAmount: trimMoney(o.discountAmount, o.currency),
    taxAmount: trimMoney(o.taxAmount, o.currency),
    couponCode: o.couponCode,
    // From the catalogue by slug: `payment_gateways` admits only the operator context, so a tenant-side join would be empty.
    gatewayName: o.gatewaySlug ? (gatewayMeta(o.gatewaySlug)?.name ?? o.gatewaySlug) : null,
    failureReason: o.failureReason,
    acceptsProof:
      o.status === 'pending' && o.gatewaySlug !== null && MANUAL_GATEWAYS.includes(o.gatewaySlug),
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
  };
}
