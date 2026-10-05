'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  CreateStoreCouponInput,
  GenerateStoreOrderPaymentLinkInput,
  ListStoreCouponsQuery,
  ListStoreCustomersQuery,
  ListStoreGroupsQuery,
  ListStoreOrdersQuery,
  ListStorePaymentsQuery,
  SaveStoreCustomerInput,
  SaveStoreGatewayInput,
  SaveWhatsappPayConfigInput,
  SendStoreOrderPaymentLinkInput,
  SetStoreGroupCodeInput,
  UpdateStoreCouponInput,
  UpdateStoreCustomerInput,
  UpdateStoreOrderStatusInput,
} from '@crm/contracts';
import { chkApi, type Page } from './service';

/** Query keys of the merchant side of the store; `all` invalidates every one of them. */
export const CHK_KEYS = {
  all: ['chk'] as const,
  orders: ['chk', 'orders'] as const,
  orderCounts: ['chk', 'order-counts'] as const,
  order: (id: string) => ['chk', 'order', id] as const,
  coupons: ['chk', 'coupons'] as const,
  couponUsages: (id: string) => ['chk', 'coupon-usages', id] as const,
  customers: ['chk', 'customers'] as const,
  customer: (id: string) => ['chk', 'customer', id] as const,
  groups: ['chk', 'groups'] as const,
  groupSummary: ['chk', 'group-summary'] as const,
  gatewayDrivers: ['chk', 'gateway-drivers'] as const,
  gateways: ['chk', 'gateways'] as const,
  resolvedGateway: (storefrontId: string | undefined) =>
    ['chk', 'resolved-gateway', storefrontId ?? ''] as const,
  payments: ['chk', 'payments'] as const,
  paymentSummary: ['chk', 'payment-summary'] as const,
  whatsappPay: ['chk', 'whatsapp-pay'] as const,
  /** Store invoices (the Sales invoice list, narrowed to the store's). */
  invoices: ['chk', 'store-invoices'] as const,
};

/** A cursor list with "load more": every list of the domain uses this one shape. `items` is every page fetched so far. */
export function useCursorList<T, Q extends object>(
  key: readonly unknown[],
  fetchPage: (query: Q & { cursor?: string }, signal?: AbortSignal) => Promise<Page<T>>,
  query: Q,
  opts: { enabled?: boolean } = {},
) {
  const q = useInfiniteQuery({
    queryKey: [...key, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => fetchPage({ ...query, cursor: pageParam }, signal),
    getNextPageParam: (last) => (last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
  return { ...q, items: q.data?.pages.flatMap((p) => p.data) ?? [] };
}

/** After any order write: the list, the tab counts, the detail and the sidebar numbers are stale. */
export function invalidateOrders(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CHK_KEYS.orders }),
    qc.invalidateQueries({ queryKey: CHK_KEYS.orderCounts }),
    qc.invalidateQueries({ queryKey: ['chk', 'order'] }),
    qc.invalidateQueries({ queryKey: CHK_KEYS.payments }),
    qc.invalidateQueries({ queryKey: CHK_KEYS.paymentSummary }),
    // The sidebar's numbers come from the store overview.
    qc.invalidateQueries({ queryKey: ['store'] }),
  ]);
}

// --- orders -------------------------------------------------------------------------------------------------------------------

export const useOrders = (query: Partial<ListStoreOrdersQuery>) =>
  useCursorList(CHK_KEYS.orders, chkApi.orders, query);

export function useOrderCounts() {
  return useQuery({
    queryKey: CHK_KEYS.orderCounts,
    queryFn: ({ signal }) => chkApi.orderCounts(signal),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15_000,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: CHK_KEYS.order(id),
    queryFn: ({ signal }) => chkApi.order(id, signal),
    retry: false,
  });
}

export function useUpdateOrderStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStoreOrderStatusInput) => chkApi.updateOrderStatus(id, body),
    onSuccess: () => invalidateOrders(qc),
  });
}

export function useSendOrderPaymentLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendStoreOrderPaymentLinkInput) => chkApi.sendOrderPaymentLink(id, body),
    onSuccess: () => invalidateOrders(qc),
  });
}

export function useGenerateOrderPaymentLink(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateStoreOrderPaymentLinkInput) =>
      chkApi.generateOrderPaymentLink(id, body),
    onSuccess: () => invalidateOrders(qc),
  });
}

export function useCreateOrderInvoice(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => chkApi.createOrderInvoice(id),
    onSuccess: () => invalidateOrders(qc),
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chkApi.deleteOrder(id),
    onSuccess: () => invalidateOrders(qc),
  });
}

// --- coupons ------------------------------------------------------------------------------------------------------------------

export const useCoupons = (query: Partial<ListStoreCouponsQuery>) =>
  useCursorList(CHK_KEYS.coupons, chkApi.coupons, query);

export function useCouponUsages(id: string | null) {
  return useCursorList(
    CHK_KEYS.couponUsages(id ?? ''),
    (q, signal) => chkApi.couponUsages(id!, q, signal),
    {},
    { enabled: id !== null },
  );
}

function invalidateCoupons(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CHK_KEYS.coupons }),
    qc.invalidateQueries({ queryKey: ['store'] }),
  ]);
}

export function useCreateCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStoreCouponInput) => chkApi.createCoupon(body),
    onSuccess: () => invalidateCoupons(qc),
  });
}

export function useUpdateCoupon(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStoreCouponInput) => chkApi.updateCoupon(id, body),
    onSuccess: () => invalidateCoupons(qc),
  });
}

export function useToggleCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chkApi.toggleCoupon(id),
    onSuccess: () => invalidateCoupons(qc),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chkApi.deleteCoupon(id),
    onSuccess: () => invalidateCoupons(qc),
  });
}

// --- customers ----------------------------------------------------------------------------------------------------------------

export const useCustomers = (query: Partial<ListStoreCustomersQuery>) =>
  useCursorList(CHK_KEYS.customers, chkApi.customers, query);

export function useCustomer(id: string | null) {
  return useQuery({
    queryKey: CHK_KEYS.customer(id ?? ''),
    queryFn: ({ signal }) => chkApi.customer(id!, signal),
    enabled: id !== null,
    retry: false,
  });
}

function invalidateCustomers(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CHK_KEYS.customers }),
    qc.invalidateQueries({ queryKey: ['chk', 'customer'] }),
    qc.invalidateQueries({ queryKey: ['store'] }),
  ]);
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveStoreCustomerInput) => chkApi.saveCustomer(body),
    onSuccess: () => invalidateCustomers(qc),
  });
}

export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateStoreCustomerInput) => chkApi.updateCustomer(id, body),
    onSuccess: () => invalidateCustomers(qc),
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chkApi.deleteCustomer(id),
    onSuccess: () => invalidateCustomers(qc),
  });
}

// --- groups -------------------------------------------------------------------------------------------------------------------

export const useGroups = (query: Partial<ListStoreGroupsQuery>) =>
  useCursorList(CHK_KEYS.groups, chkApi.groups, query);

export function useGroupSummary() {
  return useQuery({
    queryKey: CHK_KEYS.groupSummary,
    queryFn: ({ signal }) => chkApi.groupSummary(signal),
    retry: false,
  });
}

export function useSetGroupCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; body: SetStoreGroupCodeInput }) =>
      chkApi.setGroupCode(v.id, v.body),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: CHK_KEYS.groups }),
        qc.invalidateQueries({ queryKey: CHK_KEYS.groupSummary }),
      ]),
  });
}

// --- gateways -----------------------------------------------------------------------------------------------------------------

export function useGatewayDrivers() {
  return useQuery({
    queryKey: CHK_KEYS.gatewayDrivers,
    queryFn: ({ signal }) => chkApi.gatewayDrivers(signal),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useGateways() {
  return useQuery({
    queryKey: CHK_KEYS.gateways,
    queryFn: ({ signal }) => chkApi.gateways(signal),
    retry: false,
  });
}

/** What a checkout of this shop (or an invoice, with no shop) would use right now. */
export function useResolvedGateway(storefrontId: string | undefined) {
  return useQuery({
    queryKey: CHK_KEYS.resolvedGateway(storefrontId),
    queryFn: ({ signal }) => chkApi.resolvedGateway(storefrontId, signal),
    retry: false,
  });
}

function invalidateGateways(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: CHK_KEYS.gateways }),
    qc.invalidateQueries({ queryKey: ['chk', 'resolved-gateway'] }),
    // The invoice side and the order picker read the same gateway.
    qc.invalidateQueries({ queryKey: ['chk', 'order'] }),
    qc.invalidateQueries({ queryKey: ['store'] }),
    qc.invalidateQueries({ queryKey: ['invoicing', 'gateway'] }),
  ]);
}

export function useSaveGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; body: SaveStoreGatewayInput }) =>
      chkApi.saveGateway(v.slug, v.body),
    onSuccess: () => invalidateGateways(qc),
  });
}

export function useTestGateway() {
  return useMutation({
    mutationFn: (v: { slug: string; storefrontId: string | undefined }) =>
      chkApi.testGateway(v.slug, v.storefrontId),
  });
}

export function useToggleGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; storefrontId: string | undefined }) =>
      chkApi.toggleGateway(v.slug, v.storefrontId),
    onSuccess: () => invalidateGateways(qc),
  });
}

export function useSetDefaultGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; storefrontId: string | undefined }) =>
      chkApi.setDefaultGateway(v.slug, v.storefrontId),
    onSuccess: () => invalidateGateways(qc),
  });
}

export function useRemoveGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { slug: string; storefrontId: string | undefined }) =>
      chkApi.removeGateway(v.slug, v.storefrontId),
    onSuccess: () => invalidateGateways(qc),
  });
}

// --- payments -----------------------------------------------------------------------------------------------------------------

export const usePayments = (query: Partial<ListStorePaymentsQuery>) =>
  useCursorList(CHK_KEYS.payments, chkApi.payments, query);

export function usePaymentSummary() {
  return useQuery({
    queryKey: CHK_KEYS.paymentSummary,
    queryFn: ({ signal }) => chkApi.paymentSummary(signal),
    retry: false,
  });
}

export function useWhatsappPayConfigs() {
  return useQuery({
    queryKey: CHK_KEYS.whatsappPay,
    queryFn: ({ signal }) => chkApi.whatsappPay(signal),
    retry: false,
  });
}

export function useSaveWhatsappPay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveWhatsappPayConfigInput) => chkApi.saveWhatsappPay(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHK_KEYS.whatsappPay }),
  });
}

export function useDeleteWhatsappPay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => chkApi.deleteWhatsappPay(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHK_KEYS.whatsappPay }),
  });
}
