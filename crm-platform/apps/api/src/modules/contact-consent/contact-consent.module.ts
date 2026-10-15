import { Module } from '@nestjs/common';
import { ConsentSettingsService } from './consent-settings.service';
import { ConsentUnsubscribeController } from './consent-unsubscribe.controller';
import { ConsentUnsubscribeService } from './consent-unsubscribe.service';
import { ConsentGate } from './consent-gate.service';
import { ConsentIntakeService } from './consent-intake.service';
import { ConsentNoticeController } from './consent-notice.controller';
import { ConsentNoticeRepository } from './consent-notice.repository';
import { ConsentNoticeService } from './consent-notice.service';
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
  controllers: [
    ContactConsentController,
    ConsentPurposesController,
    ConsentUnsubscribeController,
    ConsentNoticeController,
  ],
  providers: [
    ConsentRepository,
    ContactConsentService,
    ConsentIntakeService,
    ConsentNoticeRepository,
    ConsentNoticeService,
    ConsentSettingsService,
    ConsentPolicyService,
    ConsentGate,
    ConsentUnsubscribeService,
    ConsentExportRepository,
    ConsentExportPublisher,
    ConsentExportService,
  ],
  exports: [
    ContactConsentService,
    ConsentIntakeService,
    ConsentNoticeService,
    ConsentSettingsService,
    ConsentPolicyService,
    ConsentGate,
    ConsentUnsubscribeService,
  ],
})
export class ContactConsentModule {}
