import { Module } from '@nestjs/common';
import { ContactConsentModule } from '../contact-consent';
import { ComplianceChecklistService } from './compliance-checklist.service';
import { ComplianceSettingsService } from './compliance-settings.service';
import { ComplianceController } from './compliance.controller';
import { ComplianceRepository } from './compliance.repository';
import { PublicTrustController } from './public-trust.controller';
import { PublicTrustService } from './public-trust.service';
import { SubprocessorsService } from './subprocessors.service';

/**
 * The Compliance center (spec docs/specs/privacy-and-data-governance.md section 11, BL-172 to BL-179): regime profiles, officer contacts,
 * privacy and terms links, the sub-processor list with its optional public page, quiet hours and calling windows (stored; BL-177 will
 * enforce them), and the checklist. A workspace-facing set of tools; it carries no claim of compliance.
 */
@Module({
  imports: [ContactConsentModule],
  controllers: [ComplianceController, PublicTrustController],
  providers: [
    ComplianceRepository,
    ComplianceSettingsService,
    SubprocessorsService,
    ComplianceChecklistService,
    PublicTrustService,
  ],
  exports: [ComplianceSettingsService],
})
export class ComplianceCenterModule {}
