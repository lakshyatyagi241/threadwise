import { Module } from '@nestjs/common';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ContactStoreOrdersController } from './contact-store-orders.controller';
import { StoreOrderBackfillService } from './store-order-backfill.service';
import { StoreOrderRepository } from './store-order.repository';
import { StoreOrderSalesService } from './store-order-sales.service';

/**
 * Store orders inside the CRM's sales module: the service (contact link, sales order, invoice, payment, a contact's order list) and the
 * contact detail's Store orders tab (`GET /v2/contacts/:contactId/store-orders`). Imported by whoever calls the service (the orders
 * screen's "Create invoice" endpoint) and by the worker module below. Kernel services (audit, outbox, RBAC) and the database are global.
 */
@Module({
  imports: [CrmModule, PlansCoreModule],
  controllers: [ContactStoreOrdersController],
  providers: [StoreOrderRepository, StoreOrderSalesService, StoreOrderBackfillService],
  exports: [StoreOrderSalesService, StoreOrderBackfillService],
})
export class StoreOrdersSalesModule {}
