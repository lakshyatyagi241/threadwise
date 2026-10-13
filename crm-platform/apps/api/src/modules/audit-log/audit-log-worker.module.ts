import { Module } from '@nestjs/common';
import { AuditLogExportProcessor } from './audit-log-export.processor';
import { AuditLogExportRunner } from './audit-log-export.runner';
import { AuditLogExportSweepService } from './audit-log-export-sweep.service';
import { AuditLogRepository } from './audit-log.repository';

/** What only the worker runs: the audit log export builder (`audit-log-export`) and its daily sweep. Imported ONLY by WorkersModule. */
@Module({
  providers: [
    AuditLogRepository,
    AuditLogExportRunner,
    AuditLogExportProcessor,
    AuditLogExportSweepService,
  ],
})
export class AuditLogWorkerModule {}
