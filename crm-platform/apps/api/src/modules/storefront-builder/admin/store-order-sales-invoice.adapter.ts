import { Injectable } from '@nestjs/common';
import { RequestContextStore } from '../../../common/context/request-context';
import { StoreOrderSalesService } from '../../store-orders-sales';
import type { StoreOrderInvoicePort, StoreOrderInvoiceResult } from '../store-order-invoice.port';

/** Binds the order page's "Create invoice" to the sales bridge: contact, sales order and invoice, refused with the plan's own problem codes. */
@Injectable()
export class StoreOrderSalesInvoiceAdapter implements StoreOrderInvoicePort {
  constructor(private readonly sales: StoreOrderSalesService) {}

  async createInvoiceForOrder(orderUuid: string): Promise<StoreOrderInvoiceResult> {
    const made = await this.sales.createInvoiceForOrder(
      RequestContextStore.require().orgId,
      orderUuid,
    );
    return {
      invoiceId: made.invoiceId,
      number: made.invoiceNumber,
      salesOrderId: made.salesOrderId,
      created: made.outcome === 'invoiced',
    };
  }
}
