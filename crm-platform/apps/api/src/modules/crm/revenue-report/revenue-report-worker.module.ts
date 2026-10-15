import { Module } from '@nestjs/common';
import { CrmModule } from '../crm.module';
import { RevenueExportProcessor } from './revenue-export.processor';
import { RevenueExportRunner } from './revenue-export.runner';
import { RevenueExportSweepService } from './revenue-export-sweep.service';

/**
 * What only the worker runs for the revenue report: the file builder (`revenue-report-export`) and its daily sweep. Imported ONLY by
 * WorkersModule: an API pod that also swept would multiply the polling load on the database.
 */
@Module({
  imports: [CrmModule],
  providers: [RevenueExportRunner, RevenueExportProcessor, RevenueExportSweepService],
})
export class RevenueReportWorkerModule {}
