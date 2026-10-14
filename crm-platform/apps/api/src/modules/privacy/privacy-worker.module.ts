import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ExportBuilder } from './engine/export-builder';
import { SubjectResolver } from './engine/subject-resolver';
import { PrivacyExportProcessor } from './requests/privacy-export.processor';
import { PrivacyExportRunner } from './requests/privacy-export.runner';
import { PrivacyMaintenanceService } from './requests/privacy-maintenance.service';
import { PrivacyRequestsRepository } from './requests/privacy-requests.repository';

/** What only the worker runs: the export builder (`privacy-export`), the hand-over of erased files to the purge queue, and the sweeps. Imported ONLY by WorkersModule. */
@Module({
  providers: [
    CryptoService,
    SubjectResolver,
    ExportBuilder,
    PrivacyRequestsRepository,
    PrivacyExportRunner,
    PrivacyExportProcessor,
    PrivacyMaintenanceService,
  ],
})
export class PrivacyWorkerModule {}
