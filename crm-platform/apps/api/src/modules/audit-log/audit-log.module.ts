import { Module } from '@nestjs/common';
import { AuditLogExportPublisher } from './audit-log-export.publisher';
import { AuditLogExportService } from './audit-log-export.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';

/**
 * The tenant-facing audit log: the list, one entry, the filters' facets and the asynchronous CSV export. The write side is the
 * kernel's `AuditService` (unchanged). The export builder and its daily sweep are in AuditLogWorkerModule (worker only).
 */
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogRepository, AuditLogService, AuditLogExportService, AuditLogExportPublisher],
})
export class AuditLogModule {}
