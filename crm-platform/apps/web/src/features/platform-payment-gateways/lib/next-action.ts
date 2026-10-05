import type { PlaceOrderResponse } from '@crm/contracts';

export type NextStep =
  | { kind: 'navigate'; url: string }
  | { kind: 'razorpay'; options: Record<string, unknown>; returnUrl: string }
  | {
      kind: 'paddle' | 'cashfree' | 'hyperpay' | 'braintree';
      params: Record<string, string | number | boolean>;
    }
  | { kind: 'form_post'; url: string; fields: Record<string, string> }
  | {
      kind: 'instructions';
      method: 'bank_transfer' | 'offline';
      rows: Array<{ label: string; value: string }>;
      notes: string | null;
      amount: string;
      currency: string;
    }
  | { kind: 'done' };

/** Turns the API's `next` into what the browser does. The widget options are built here from plain parameters, never from HTML. */
export function nextStep(res: PlaceOrderResponse): NextStep {
  const n = res.next;
  if (n.type === 'redirect') return { kind: 'navigate', url: n.url };
  if (n.type === 'paid') return { kind: 'done' };
  if (n.type === 'form_post') return { kind: 'form_post', url: n.url, fields: n.fields };
  if (n.type === 'instructions') {
    return {
      kind: 'instructions',
      method: n.kind,
      rows: n.rows,
      notes: n.notes,
      amount: n.amount,
      currency: n.currency,
    };
  }
  if (n.provider !== 'razorpay') return { kind: n.provider, params: n.params };
  const p = n.params;
  // A subscription (auto-renew) opens Razorpay with its subscription id and no amount or order: the plan already carries the price.
  // The widget then hands back razorpay_subscription_id, which the return endpoint needs to verify `payment_id|subscription_id`.
  if (p.subscriptionId) {
    return {
      kind: 'razorpay',
      returnUrl: String(p.callbackUrl),
      options: {
        key: p.keyId,
        subscription_id: p.subscriptionId,
        name: p.name,
        description: p.description,
        prefill: { name: p.prefillName, email: p.prefillEmail },
      },
    };
  }
  return {
    kind: 'razorpay',
    returnUrl: String(p.callbackUrl),
    options: {
      key: p.keyId,
      order_id: p.orderId,
      amount: p.amountMinor,
      currency: p.currency,
      name: p.name,
      description: p.description,
      prefill: { name: p.prefillName, email: p.prefillEmail },
    },
  };
}

/** Where the return endpoint sent the buyer: `?payment=` plus the order number. */
export type PaymentOutcome = 'success' | 'failed' | 'cancelled' | 'pending' | 'proof' | 'notfound';
const OUTCOMES: readonly string[] = [
  'success',
  'failed',
  'cancelled',
  'pending',
  'proof',
  'notfound',
];
export const parseOutcome = (v: string | null): PaymentOutcome | null =>
  v && OUTCOMES.includes(v) ? (v as PaymentOutcome) : null;
