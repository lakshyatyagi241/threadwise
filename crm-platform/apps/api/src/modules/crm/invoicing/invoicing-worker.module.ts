import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { InvoiceOverdueSweepService } from './invoice-overdue-sweep.service';
import { RecurringInvoiceSweepService } from './recurring-invoice-sweep.service';

/**
 * The invoicing sweeps. Imported ONLY by WorkersModule (the worker process): an API pod that also swept would multiply the polling
 * load on the database, so the sweeps are not part of CrmModule.
 */
@Module({
  imports: [CrmModule],
  providers: [InvoiceOverdueSweepService, RecurringInvoiceSweepService],
})
export class InvoicingWorkerModule {}
