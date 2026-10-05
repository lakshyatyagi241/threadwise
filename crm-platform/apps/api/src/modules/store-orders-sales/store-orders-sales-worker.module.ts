import { Module } from '@nestjs/common';
import { StoreOrderSalesConsumer } from './store-order-sales.consumer';
import { StoreOrdersSalesModule } from './store-orders-sales.module';

/** The order-event consumer. Imported ONLY by WorkersModule: the HTTP app records an order, the worker bridges it into Sales. */
@Module({ imports: [StoreOrdersSalesModule], providers: [StoreOrderSalesConsumer] })
export class StoreOrdersSalesWorkerModule {}
