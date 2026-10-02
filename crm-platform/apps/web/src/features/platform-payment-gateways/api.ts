import {
  paygwGatewayItemSchema,
  paygwGatewayListResponseSchema,
  paygwOrdersResponseSchema,
  paygwQuoteSchema,
  placeOrderResponseSchema,
  type PaygwQuoteQuery,
  type PlacePlanOrderRequest,
  type PlaceWalletOrderRequest,
  type SetPaygwGatewayActiveRequest,
  type UpdatePaygwGatewayRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';
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
export const checkoutKey = (kind: string, ...rest: unknown[]) => ['billing', 'checkout', kind, ...rest] as const;

export const fetchPlanQuote = (planSlug: string, q: PaygwQuoteQuery, signal?: AbortSignal) =>
  apiFetch(`/billing/checkout/plans/${encodeURIComponent(planSlug)}/quote`, {
    query: q,
    schema: paygwQuoteSchema,
    signal,
  });

export const fetchWalletQuote = (q: PaygwQuoteQuery & { amount: string }, signal?: AbortSignal) =>
  apiFetch('/billing/checkout/wallet/quote', { query: q, schema: paygwQuoteSchema, signal });

export const placePlanOrder = (planSlug: string, body: PlacePlanOrderRequest, idempotencyKey: string) =>
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
  apiFetch('/billing/orders', { query: { limit: 25, cursor }, schema: paygwOrdersResponseSchema, signal });
