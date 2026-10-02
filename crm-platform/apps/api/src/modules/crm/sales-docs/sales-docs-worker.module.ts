import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { SalesDocExpirySweepService } from './sales-doc-expiry-sweep.service';

/**
 * The expiry sweep. Imported ONLY by WorkersModule (the worker process): an API pod that also swept would multiply the polling load on
 * the database, so the sweep is not part of CrmModule.
 */
@Module({
  imports: [CrmModule],
  providers: [SalesDocExpirySweepService],
})
export class SalesDocsWorkerModule {}
