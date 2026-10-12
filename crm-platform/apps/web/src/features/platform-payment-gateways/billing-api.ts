import {
  adminCancelSubscriptionResponseSchema,
  adminSubscriptionChargesResponseSchema,
  adminSubscriptionsResponseSchema,
  refundResponseSchema,
  adminOrdersResponseSchema,
  billingAnalyticsResponseSchema,
  billingHistoryResponseSchema,
  billingSettingsResponseSchema,
  exportResponseSchema,
  invoiceActionResponseSchema,
  invoiceViewSchema,
  invoicesResponseSchema,
  orderActionResponseSchema,
  orderAnalyticsResponseSchema,
  type AdminCancelSubscriptionRequest,
  type AdminSubscriptionsQuery,
  type RefundRequest,
  type SubscriptionRefundRequest,
  type AdminOrdersQuery,
  type BillingAnalyticsQuery,
  type BillingHistoryQuery,
  type InvoiceMarkPaidRequest,
  type InvoicesQuery,
  type ManualInvoiceRequest,
  type OrderActionRequest,
  type OrderAnalyticsQuery,
  type SaveBillingSettingsRequest,
} from '@crm/contracts';
import { z } from 'zod';
import { operatorFetch } from '@/features/auth-registration-security/platform/operator-fetch';

/** The operator console's Billing screens, through the same-origin operator proxy (`/api/platform/billing/*`). */
export const BILLING_KEYS = {
  orders: ['operator', 'billing', 'orders'] as const,
  orderAnalytics: ['operator', 'billing', 'order-analytics'] as const,
  history: ['operator', 'billing', 'history'] as const,
  historyAnalytics: ['operator', 'billing', 'history-analytics'] as const,
  invoices: ['operator', 'billing', 'invoices'] as const,
  subscriptions: ['operator', 'billing', 'subscriptions'] as const,
  subscriptionCharges: (id: string) => ['operator', 'billing', 'subscription-charges', id] as const,
  invoice: (id: string) => ['operator', 'billing', 'invoice', id] as const,
  settings: ['operator', 'billing', 'settings'] as const,
};

type Q = Record<string, string | number | boolean | undefined>;
const q = <T extends object>(v: T): Q => v as unknown as Q;

export const billingApi = {
  orders: (query: Partial<AdminOrdersQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/orders', {
      query: q(query),
      schema: adminOrdersResponseSchema,
      signal,
    }),
  orderAnalytics: (query: Partial<OrderAnalyticsQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/orders/analytics', {
      query: q(query),
      schema: orderAnalyticsResponseSchema,
      signal,
    }),
  exportOrders: (query: Partial<AdminOrdersQuery>) =>
    operatorFetch('/billing/orders/export', { query: q(query), schema: exportResponseSchema }),
  approve: (id: string) =>
    operatorFetch(`/billing/orders/${id}/approve`, {
      method: 'POST',
      schema: orderActionResponseSchema,
    }),
  reject: (id: string, body: OrderActionRequest) =>
    operatorFetch(`/billing/orders/${id}/reject`, {
      method: 'POST',
      body,
      schema: orderActionResponseSchema,
    }),
  cancel: (id: string) =>
    operatorFetch(`/billing/orders/${id}/cancel`, {
      method: 'POST',
      schema: orderActionResponseSchema,
    }),

  subscriptions: (query: Partial<AdminSubscriptionsQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/subscriptions', {
      query: q(query),
      schema: adminSubscriptionsResponseSchema,
      signal,
    }),
  subscriptionCharges: (id: string, signal?: AbortSignal) =>
    operatorFetch(`/billing/subscriptions/${id}/charges`, {
      schema: adminSubscriptionChargesResponseSchema,
      signal,
    }),
  cancelSubscription: (id: string, body: AdminCancelSubscriptionRequest) =>
    operatorFetch(`/billing/subscriptions/${id}/cancel`, {
      method: 'POST',
      body,
      schema: adminCancelSubscriptionResponseSchema,
    }),
  syncSubscription: (id: string) =>
    operatorFetch(`/billing/subscriptions/${id}/sync`, {
      method: 'POST',
      schema: z.object({ outcome: z.string() }).passthrough(),
    }),
  refundOrder: (id: string, body: RefundRequest) =>
    operatorFetch(`/billing/orders/${id}/refund`, {
      method: 'POST',
      body,
      schema: refundResponseSchema,
    }),
  refundSubscription: (id: string, body: SubscriptionRefundRequest) =>
    operatorFetch(`/billing/subscriptions/${id}/refund`, {
      method: 'POST',
      body,
      schema: refundResponseSchema,
    }),

  history: (query: Partial<BillingHistoryQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/history', {
      query: q(query),
      schema: billingHistoryResponseSchema,
      signal,
    }),
  historyAnalytics: (query: Partial<BillingAnalyticsQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/history/analytics', {
      query: q(query),
      schema: billingAnalyticsResponseSchema,
      signal,
    }),
  exportHistory: (query: Partial<BillingHistoryQuery>) =>
    operatorFetch('/billing/history/export', { query: q(query), schema: exportResponseSchema }),

  invoices: (query: Partial<InvoicesQuery>, signal?: AbortSignal) =>
    operatorFetch('/billing/invoices', {
      query: q(query),
      schema: invoicesResponseSchema,
      signal,
    }),
  exportInvoices: (query: Partial<InvoicesQuery>) =>
    operatorFetch('/billing/invoices/export', { query: q(query), schema: exportResponseSchema }),
  invoice: (id: string, signal?: AbortSignal) =>
    operatorFetch(`/billing/invoices/${id}`, { schema: invoiceViewSchema, signal }),
  createInvoice: (body: ManualInvoiceRequest) =>
    operatorFetch('/billing/invoices', {
      method: 'POST',
      body,
      schema: z.object({ id: z.string(), number: z.string() }),
    }),
  markPaid: (id: string, body: InvoiceMarkPaidRequest) =>
    operatorFetch(`/billing/invoices/${id}/mark-paid`, {
      method: 'POST',
      body,
      schema: invoiceActionResponseSchema,
    }),
  voidInvoice: (id: string) =>
    operatorFetch(`/billing/invoices/${id}/void`, {
      method: 'POST',
      schema: invoiceActionResponseSchema,
    }),
  deleteInvoice: (id: string) =>
    operatorFetch(`/billing/invoices/${id}`, {
      method: 'DELETE',
      schema: invoiceActionResponseSchema,
    }),

  settings: (signal?: AbortSignal) =>
    operatorFetch('/billing/settings', { schema: billingSettingsResponseSchema, signal }),
  saveSettings: (body: SaveBillingSettingsRequest) =>
    operatorFetch('/billing/settings', {
      method: 'PUT',
      body,
      schema: billingSettingsResponseSchema,
    }),
  removeLogo: () =>
    operatorFetch('/billing/settings/logo', {
      method: 'DELETE',
      schema: billingSettingsResponseSchema,
    }),
};

/** The logo is a multipart upload, which operatorFetch (JSON only) does not do; the proxy forwards it unchanged. */
export async function uploadInvoiceLogo(file: File) {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/platform/billing/settings/logo', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const detail = (json as { detail?: string } | undefined)?.detail;
    throw new Error(detail ?? `Upload failed (${res.status})`);
  }
  return billingSettingsResponseSchema.parse(json);
}
