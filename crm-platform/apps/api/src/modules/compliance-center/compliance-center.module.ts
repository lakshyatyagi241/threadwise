import { Module } from '@nestjs/common';
import { ContactConsentModule } from '../contact-consent';
import { ComplianceChecklistService } from './compliance-checklist.service';
import { ComplianceSettingsService } from './compliance-settings.service';
import { ComplianceController } from './compliance.controller';
import { DncService } from './dnc.service';
import { ComplianceRepository } from './compliance.repository';
import { PublicTrustController } from './public-trust.controller';
import { PublicTrustService } from './public-trust.service';
import { SendWindowModule } from './send-window.module';
import { SubprocessorsService } from './subprocessors.service';

/**
 * The Compliance center (spec docs/specs/privacy-and-data-governance.md section 11, BL-172 to BL-179): regime profiles, officer contacts,
 * privacy and terms links, the sub-processor list with its optional public page, quiet hours and calling windows (enforced by deferring, BL-177: see
 * `SendWindowService`), and the checklist. A workspace-facing set of tools; it carries no claim of compliance.
 */
@Module({
  imports: [ContactConsentModule, SendWindowModule],
  controllers: [ComplianceController, PublicTrustController],
  providers: [
    ComplianceRepository,
    ComplianceSettingsService,
    SubprocessorsService,
    DncService,
    ComplianceChecklistService,
    PublicTrustService,
  ],
  exports: [ComplianceSettingsService],
})
export class ComplianceCenterModule {}
