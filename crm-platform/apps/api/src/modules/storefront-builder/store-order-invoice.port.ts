/**
 * What the store orders screen needs of invoicing: turn one store order into a sales order and an invoice (WaDesk's auto-invoice,
 * run by hand from the order page). The sales bridge (`StoreOrderSalesService.createInvoiceForOrder`, module store-orders-sales) does
 * the work; `admin/store-order-sales-invoice.adapter.ts` binds it to this token. A leaf file (a token and types, nothing imported at
 * runtime), so a test or another domain can provide its own implementation.
 */
export interface StoreOrderInvoiceResult {
  /** Public ids. */
  invoiceId: string;
  number: string | null;
  salesOrderId: string | null;
  /** False when the order already had an invoice and this is that one. */
  created: boolean;
}

export interface StoreOrderInvoicePort {
  /** `orderUuid` is the public id of the `wa_orders` row. Runs in the caller's tenant context. */
  createInvoiceForOrder(orderUuid: string): Promise<StoreOrderInvoiceResult>;
}

export const STORE_ORDER_INVOICE = Symbol('STORE_ORDER_INVOICE');
