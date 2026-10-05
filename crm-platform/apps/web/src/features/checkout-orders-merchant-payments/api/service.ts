import {
  createStoreOrderInvoiceResponseSchema,
  storeCouponListResponseSchema,
  storeCouponSchema,
  storeCouponUsageListResponseSchema,
  storeCustomerDetailSchema,
  storeCustomerListResponseSchema,
  storeCustomerSchema,
  storeGatewayDriverListResponseSchema,
  storeGatewayListResponseSchema,
  storeGatewaySchema,
  storeGatewayTestSchema,
  storeGroupListResponseSchema,
  storeGroupSchema,
  storeGroupSummarySchema,
  storeOrderCountsSchema,
  storeOrderDetailSchema,
  storeOrderListResponseSchema,
  storeOrderPaymentLinkResponseSchema,
  storeOrderStatusResponseSchema,
  storePaymentListResponseSchema,
  storePaymentSummarySchema,
  storeResolvedGatewaySchema,
  whatsappPayConfigSchema,
  whatsappPayListResponseSchema,
  type CreateStoreCouponInput,
  type GenerateStoreOrderPaymentLinkInput,
  type ListStoreCouponsQuery,
  type ListStoreCouponUsagesQuery,
  type ListStoreCustomersQuery,
  type ListStoreGroupsQuery,
  type ListStoreOrdersQuery,
  type ListStorePaymentsQuery,
  type PageResponse,
  type SaveStoreCustomerInput,
  type SaveStoreGatewayInput,
  type SaveWhatsappPayConfigInput,
  type SendStoreOrderPaymentLinkInput,
  type SetStoreGroupCodeInput,
  type UpdateStoreCouponInput,
  type UpdateStoreCustomerInput,
  type UpdateStoreOrderStatusInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

type Query = Record<string, string | number | boolean | undefined>;

/** A list page: `{ data, page }`. */
export type Page<T> = PageResponse<T>;

const enc = encodeURIComponent;

/**
 * Every call of the merchant side of the store (orders, coupons, customers, groups, gateways, payments). Shapes come from
 * `@crm/contracts` (checkout-orders-merchant-payments); every response is parsed at the boundary.
 */
export const chkApi = {
  // --- orders ---------------------------------------------------------------------------------------------------------------
  orders: (query: Partial<ListStoreOrdersQuery>, signal?: AbortSignal) =>
    apiFetch('/store/orders', {
      query: query as Query,
      schema: storeOrderListResponseSchema,
      signal,
    }),
  orderCounts: (signal?: AbortSignal) =>
    apiFetch('/store/orders/counts', { schema: storeOrderCountsSchema, signal }),
  order: (id: string, signal?: AbortSignal) =>
    apiFetch(`/store/orders/${enc(id)}`, { schema: storeOrderDetailSchema, signal }),
  updateOrderStatus: (id: string, body: UpdateStoreOrderStatusInput) =>
    apiFetch(`/store/orders/${enc(id)}/status`, {
      method: 'PATCH',
      body,
      schema: storeOrderStatusResponseSchema,
    }),
  sendOrderPaymentLink: (id: string, body: SendStoreOrderPaymentLinkInput) =>
    apiFetch(`/store/orders/${enc(id)}/payment-link`, {
      method: 'POST',
      body,
      schema: storeOrderPaymentLinkResponseSchema,
    }),
  generateOrderPaymentLink: (id: string, body: GenerateStoreOrderPaymentLinkInput) =>
    apiFetch(`/store/orders/${enc(id)}/generate-payment-link`, {
      method: 'POST',
      body,
      schema: storeOrderPaymentLinkResponseSchema,
    }),
  createOrderInvoice: (id: string) =>
    apiFetch(`/store/orders/${enc(id)}/create-invoice`, {
      method: 'POST',
      body: {},
      schema: createStoreOrderInvoiceResponseSchema,
    }),
  deleteOrder: (id: string) => apiFetch(`/store/orders/${enc(id)}`, { method: 'DELETE' }),

  // --- coupons --------------------------------------------------------------------------------------------------------------
  coupons: (query: Partial<ListStoreCouponsQuery>, signal?: AbortSignal) =>
    apiFetch('/store/coupons', {
      query: query as Query,
      schema: storeCouponListResponseSchema,
      signal,
    }),
  couponUsages: (id: string, query: Partial<ListStoreCouponUsagesQuery>, signal?: AbortSignal) =>
    apiFetch(`/store/coupons/${enc(id)}/usages`, {
      query: query as Query,
      schema: storeCouponUsageListResponseSchema,
      signal,
    }),
  createCoupon: (body: CreateStoreCouponInput) =>
    apiFetch('/store/coupons', { method: 'POST', body, schema: storeCouponSchema }),
  updateCoupon: (id: string, body: UpdateStoreCouponInput) =>
    apiFetch(`/store/coupons/${enc(id)}`, { method: 'PUT', body, schema: storeCouponSchema }),
  toggleCoupon: (id: string) =>
    apiFetch(`/store/coupons/${enc(id)}/toggle`, {
      method: 'POST',
      body: {},
      schema: storeCouponSchema,
    }),
  deleteCoupon: (id: string) => apiFetch(`/store/coupons/${enc(id)}`, { method: 'DELETE' }),

  // --- customers ------------------------------------------------------------------------------------------------------------
  customers: (query: Partial<ListStoreCustomersQuery>, signal?: AbortSignal) =>
    apiFetch('/store/customers', {
      query: query as Query,
      schema: storeCustomerListResponseSchema,
      signal,
    }),
  customer: (id: string, signal?: AbortSignal) =>
    apiFetch(`/store/customers/${enc(id)}`, { schema: storeCustomerDetailSchema, signal }),
  /** Upsert by phone: the same form creates or updates. */
  saveCustomer: (body: SaveStoreCustomerInput) =>
    apiFetch('/store/customers', { method: 'POST', body, schema: storeCustomerSchema }),
  updateCustomer: (id: string, body: UpdateStoreCustomerInput) =>
    apiFetch(`/store/customers/${enc(id)}`, { method: 'PUT', body, schema: storeCustomerSchema }),
  deleteCustomer: (id: string) => apiFetch(`/store/customers/${enc(id)}`, { method: 'DELETE' }),

  // --- groups ---------------------------------------------------------------------------------------------------------------
  groups: (query: Partial<ListStoreGroupsQuery>, signal?: AbortSignal) =>
    apiFetch('/store/groups', {
      query: query as Query,
      schema: storeGroupListResponseSchema,
      signal,
    }),
  groupSummary: (signal?: AbortSignal) =>
    apiFetch('/store/groups/summary', { schema: storeGroupSummarySchema, signal }),
  setGroupCode: (id: string, body: SetStoreGroupCodeInput) =>
    apiFetch(`/store/groups/${enc(id)}/code`, { method: 'PUT', body, schema: storeGroupSchema }),

  // --- gateways (the one workspace gateway) -----------------------------------------------------------------------------------
  gatewayDrivers: (signal?: AbortSignal) =>
    apiFetch('/store/gateways/drivers', { schema: storeGatewayDriverListResponseSchema, signal }),
  gateways: (signal?: AbortSignal) =>
    apiFetch('/store/gateways', { schema: storeGatewayListResponseSchema, signal }),
  resolvedGateway: (storefrontId: string | undefined, signal?: AbortSignal) =>
    apiFetch('/store/gateways/resolved', {
      query: { storefrontId },
      schema: storeResolvedGatewaySchema,
      signal,
    }),
  saveGateway: (slug: string, body: SaveStoreGatewayInput) =>
    apiFetch(`/store/gateways/${enc(slug)}`, { method: 'PUT', body, schema: storeGatewaySchema }),
  testGateway: (slug: string, storefrontId: string | undefined) =>
    apiFetch(`/store/gateways/${enc(slug)}/test`, {
      method: 'POST',
      query: { storefrontId },
      body: {},
      schema: storeGatewayTestSchema,
    }),
  toggleGateway: (slug: string, storefrontId: string | undefined) =>
    apiFetch(`/store/gateways/${enc(slug)}/toggle`, {
      method: 'POST',
      query: { storefrontId },
      body: {},
      schema: storeGatewaySchema,
    }),
  setDefaultGateway: (slug: string, storefrontId: string | undefined) =>
    apiFetch(`/store/gateways/${enc(slug)}/default`, {
      method: 'POST',
      query: { storefrontId },
      body: {},
      schema: storeGatewaySchema,
    }),
  removeGateway: (slug: string, storefrontId: string | undefined) =>
    apiFetch(`/store/gateways/${enc(slug)}`, { method: 'DELETE', query: { storefrontId } }),

  // --- payments -------------------------------------------------------------------------------------------------------------
  payments: (query: Partial<ListStorePaymentsQuery>, signal?: AbortSignal) =>
    apiFetch('/store/payments', {
      query: query as Query,
      schema: storePaymentListResponseSchema,
      signal,
    }),
  paymentSummary: (signal?: AbortSignal) =>
    apiFetch('/store/payments/summary', { schema: storePaymentSummarySchema, signal }),
  whatsappPay: (signal?: AbortSignal) =>
    apiFetch('/store/payments/whatsapp-pay', { schema: whatsappPayListResponseSchema, signal }),
  saveWhatsappPay: (body: SaveWhatsappPayConfigInput) =>
    apiFetch('/store/payments/whatsapp-pay', {
      method: 'PUT',
      body,
      schema: whatsappPayConfigSchema,
    }),
  deleteWhatsappPay: (id: string) =>
    apiFetch(`/store/payments/whatsapp-pay/${enc(id)}`, { method: 'DELETE' }),
};
