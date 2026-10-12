import { Module } from '@nestjs/common';
import { ConsentSettingsService } from './consent-settings.service';
import { ConsentPolicyService } from './consent-policy.service';
import { ConsentRepository } from './consent.repository';
import { ContactConsentController } from './consent.controller';
import { ContactConsentService } from './consent.service';

/**
 * The contact consent ledger (spec docs/specs/contact-consent-ledger.md): the API, the settings, and the services other modules call
 * to record consent or to ask the send policy. The inbound STOP listener is in ContactConsentWorkerModule (worker only).
 */
@Module({
  controllers: [ContactConsentController],
  providers: [
    ConsentRepository,
    ContactConsentService,
    ConsentSettingsService,
    ConsentPolicyService,
  ],
  exports: [ContactConsentService, ConsentSettingsService, ConsentPolicyService],
})
export class ContactConsentModule {}
