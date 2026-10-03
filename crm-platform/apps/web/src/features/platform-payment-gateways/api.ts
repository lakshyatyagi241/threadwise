import {
  paygwGatewayItemSchema,
  paygwGatewayListResponseSchema,
  paygwBuyerInvoiceSchema,
  paygwOrdersResponseSchema,
  paygwProofResponseSchema,
  paygwQuoteSchema,
  placeOrderResponseSchema,
  type PaygwQuoteQuery,
  type PlacePlanOrderRequest,
  type PlaceWalletOrderRequest,
  type SetPaygwGatewayActiveRequest,
  type UpdatePaygwGatewayRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
import { toApiError } from '@/lib/api/errors';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** Operator console: through the same-origin operator proxy (`/api/platform/*`). */
export const GATEWAYS_KEY = ['operator', 'payment-gateways'] as const;

export const fetchGateways = (signal?: AbortSignal) =>
  operatorFetch('/payment-gateways', { schema: paygwGatewayListResponseSchema, signal });

export const saveGateway = (id: string, body: UpdatePaygwGatewayRequest) =>
  operatorFetch(`/payment-gateways/${id}`, {
    method: 'PATCH',
    body,
    schema: paygwGatewayItemSchema,
  });

export const setGatewayActive = (id: string, body: SetPaygwGatewayActiveRequest) =>
  operatorFetch(`/payment-gateways/${id}/active`, {
    method: 'POST',
    body,
    schema: paygwGatewayItemSchema,
  });

/** Workspace side: through the staff proxy (`/api/v2/*`). */
export const checkoutKey = (kind: string, ...rest: unknown[]) =>
  ['billing', 'checkout', kind, ...rest] as const;

export const fetchPlanQuote = (planSlug: string, q: PaygwQuoteQuery, signal?: AbortSignal) =>
  apiFetch(`/billing/checkout/plans/${encodeURIComponent(planSlug)}/quote`, {
    query: q,
    schema: paygwQuoteSchema,
    signal,
  });

export const fetchWalletQuote = (q: PaygwQuoteQuery & { amount: string }, signal?: AbortSignal) =>
  apiFetch('/billing/checkout/wallet/quote', { query: q, schema: paygwQuoteSchema, signal });

export const placePlanOrder = (
  planSlug: string,
  body: PlacePlanOrderRequest,
  idempotencyKey: string,
) =>
  apiFetch(`/billing/checkout/plans/${encodeURIComponent(planSlug)}/orders`, {
    method: 'POST',
    body,
    idempotencyKey,
    schema: placeOrderResponseSchema,
  });

export const placeWalletOrder = (body: PlaceWalletOrderRequest, idempotencyKey: string) =>
  apiFetch('/billing/checkout/wallet/orders', {
    method: 'POST',
    body,
    idempotencyKey,
    schema: placeOrderResponseSchema,
  });

export const ORDERS_KEY = ['billing', 'orders'] as const;
export const fetchOrders = (cursor?: string, signal?: AbortSignal) =>
  apiFetch('/billing/orders', {
    query: { limit: 25, cursor },
    schema: paygwOrdersResponseSchema,
    signal,
  });

export const orderInvoiceKey = (id: string) => ['billing', 'orders', id, 'invoice'] as const;
export const fetchOrderInvoice = (id: string, signal?: AbortSignal) =>
  apiFetch(`/billing/orders/${encodeURIComponent(id)}/invoice`, {
    schema: paygwBuyerInvoiceSchema,
    signal,
  });

/**
 * The proof upload is a multipart POST, which the JSON helper does not send. Same proxy and error mapping; the browser sets
 * the multipart boundary itself.
 */
export async function uploadProof(
  orderId: string,
  file: File,
  fields: { paymentReference?: string; proofNote?: string },
) {
  const form = new FormData();
  if (fields.paymentReference) form.set('paymentReference', fields.paymentReference);
  if (fields.proofNote) form.set('proofNote', fields.proofNote);
  form.set('proof', file);
  const res = await fetch(`/api/v2/billing/orders/${encodeURIComponent(orderId)}/proof`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: form,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    throw toApiError(
      res.status,
      json,
      res.headers.get('x-request-id'),
      res.headers.get('retry-after'),
    );
  }
  return paygwProofResponseSchema.parse(json);
}
