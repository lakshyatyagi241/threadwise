import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PersonalDataErasureService } from './engine/erasure.service';
import { ExportBuilder } from './engine/export-builder';
import { SubjectResolver } from './engine/subject-resolver';
import { LegalHoldGuard } from './legal-holds/legal-hold.guard';
import { LegalHoldsController } from './legal-holds/legal-holds.controller';
import { LegalHoldsRepository } from './legal-holds/legal-holds.repository';
import { LegalHoldsService } from './legal-holds/legal-holds.service';
import { ErasureExecutor } from './requests/erasure-executor';
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
  controllers: [PrivacyRequestsController, LegalHoldsController],
  providers: [
    CryptoService,
    SubjectResolver,
    PersonalDataErasureService,
    ExportBuilder,
    PrivacyRequestsRepository,
    PrivacyRequestsService,
    PrivacyExportPublisher,
    ErasureExecutor,
    LegalHoldGuard,
    LegalHoldsRepository,
    LegalHoldsService,
  ],
  exports: [PersonalDataErasureService, SubjectResolver, LegalHoldGuard],
})
export class PrivacyModule {}
