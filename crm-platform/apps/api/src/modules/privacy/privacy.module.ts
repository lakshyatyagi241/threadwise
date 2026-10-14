import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PersonalDataErasureService } from './engine/erasure.service';
import { ExportBuilder } from './engine/export-builder';
import { SubjectResolver } from './engine/subject-resolver';
import { PrivacyExportPublisher } from './requests/privacy-export.publisher';
import { PrivacyRequestsController } from './requests/privacy-requests.controller';
import { PrivacyRequestsRepository } from './requests/privacy-requests.repository';
import { PrivacyRequestsService } from './requests/privacy-requests.service';

/**
 * The rights service and the personal-data registry (spec docs/specs/privacy-and-data-governance.md section 4.5): data requests
 * (`/v2/privacy`), the export of one person, the erasure pipeline that the CRM's contact delete shares. The worker half (export
 * builder, storage hand-over, sweeps) is in PrivacyWorkerModule.
 */
@Module({
  controllers: [PrivacyRequestsController],
  providers: [
    CryptoService,
    SubjectResolver,
    PersonalDataErasureService,
    ExportBuilder,
    PrivacyRequestsRepository,
    PrivacyRequestsService,
    PrivacyExportPublisher,
  ],
  exports: [PersonalDataErasureService, SubjectResolver],
})
export class PrivacyModule {}
