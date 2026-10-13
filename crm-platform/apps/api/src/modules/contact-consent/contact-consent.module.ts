import { Module } from '@nestjs/common';
import { ConsentSettingsService } from './consent-settings.service';
import { ConsentGate } from './consent-gate.service';
import { ConsentPolicyService } from './consent-policy.service';
import { ConsentPurposesController } from './consent-purposes.controller';
import { ConsentExportPublisher } from './consent-export.publisher';
import { ConsentExportRepository } from './consent-export.repository';
import { ConsentExportService } from './consent-export.service';
import { ConsentRepository } from './consent.repository';
import { ContactConsentController } from './consent.controller';
import { ContactConsentService } from './consent.service';

/**
 * The contact consent ledger (spec docs/specs/contact-consent-ledger.md): the API, the settings, and the services other modules call
 * to record consent or to ask the send policy. The inbound STOP listener is in ContactConsentWorkerModule (worker only).
 */
@Module({
  controllers: [ContactConsentController, ConsentPurposesController],
  providers: [
    ConsentRepository,
    ContactConsentService,
    ConsentSettingsService,
    ConsentPolicyService,
    ConsentGate,
    ConsentExportRepository,
    ConsentExportPublisher,
    ConsentExportService,
  ],
  exports: [ContactConsentService, ConsentSettingsService, ConsentPolicyService, ConsentGate],
})
export class ContactConsentModule {}
