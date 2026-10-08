/**
 * Public surface of the store-orders-sales bridge (store orders inside the CRM's sales module). Other domains import only from here.
 *
 * - `StoreOrderSalesService.createInvoiceForOrder(orgId, orderUuidOrNo)`: the manual "Create invoice" button.
 * - `StoreOrderSalesService.syncOrder(orgId, { uuid | id })`: the same step the outbox consumer runs, for a caller that just changed an order.
 * - `StoreOrderBackfillService.run({ orgId?, dryRun })`: the catch-up for orders without a contact (the `backfill:store-orders` CLI).
 * - `StoreOrderSalesService.listForContact(contactUuid, limit?)`: a contact's store orders, for its detail page.
 */
export { StoreOrdersSalesModule } from './store-orders-sales.module';
export { StoreOrdersSalesWorkerModule } from './store-orders-sales-worker.module';
export { StoreOrderSalesService } from './store-order-sales.service';
export { StoreOrderBackfillService } from './store-order-backfill.service';
export type {
  BackfillOptions,
  BackfillSkip,
  BackfillSummary,
} from './store-order-backfill.service';
export type { CreatedStoreInvoice, StoreOrderSyncResult } from './store-order-sales.service';
export { STORE_ORDER_EVENTS } from './store-order-sales.consumer';
