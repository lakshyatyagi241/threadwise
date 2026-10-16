import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { EmailTemplatesModule } from '../email-templates';
import { MessageTemplatesModule } from '../message-templates';
import { ContactAttributionController } from './contact-attribution.controller';
import { ContactAttributionService } from './contact-attribution.service';
import { LeadHooksController } from './lead-hooks.controller';
import { LeadHooksService } from './lead-hooks.service';
import { LeadFirstMessageLookups } from './lead-first-message.lookups';
import { LeadHookAddressService } from './lead-hook-address';
import { LeadIngestModule } from './lead-ingest.module';
import { LeadSourcesController } from './lead-sources.controller';
import { LeadSourcesService } from './lead-sources.service';
import { LeadHookThrottle } from './lead-throttle';

/**
 * The lead pipeline's HTTP side (EXT-LEAD, spec L-01..L-12): the management API under `/v2/lead-sources`, the public webhook door
 * `POST /v2/public/lead-hooks/:token`, and a contact's attribution. The pipeline itself is `LeadIngestModule`; the notification consumer
 * and the payload retention sweep are `LeadsWorkerModule` (the worker process only).
 */
@Module({
  imports: [LeadIngestModule, CrmModule, MessageTemplatesModule, EmailTemplatesModule],
  controllers: [LeadSourcesController, LeadHooksController, ContactAttributionController],
  providers: [
    CryptoService,
    LeadSourcesService,
    LeadHooksService,
    LeadHookThrottle,
    LeadHookAddressService,
    LeadFirstMessageLookups,
    ContactAttributionService,
  ],
})
export class LeadsModule {}
