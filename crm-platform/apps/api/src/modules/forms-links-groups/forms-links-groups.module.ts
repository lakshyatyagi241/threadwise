import { Module } from '@nestjs/common';
import { WaFormFlowsModule } from '../../infra/providers/forms-links-groups/wa-form-flows.module';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WaChatLinkRedirectController } from './wa-chat-link-redirect.controller';
import { WaChatLinksController } from './wa-chat-links.controller';
import { WaChatLinksRepository } from './wa-chat-links.repository';
import { WaChatLinksService } from './wa-chat-links.service';
import { WaFormsController } from './wa-forms.controller';
import { WaFormsRepository } from './wa-forms.repository';
import { WaFormsService } from './wa-forms.service';
import { WaLinkRedirectThrottle } from './wa-link-redirect-throttle';

/**
 * forms-links-groups (WFL): WhatsApp Forms and the Link Generator (docs/threadwise-port/inventory/
 * forms-links-groups.md). WABA Cloud API Groups and the unofficial group directory are sibling Reference features
 * already built elsewhere (`whatsapp-cloud-api-waba`, `storefront-builder`, `whatsapp-devices-baileys`) — not
 * duplicated here.
 *
 * `WABA_CONNECTIONS` (credential resolution for publish) comes from the global `WabaModule`; no import needed.
 */
@Module({
  imports: [PlansCoreModule, WaFormFlowsModule],
  controllers: [WaFormsController, WaChatLinksController, WaChatLinkRedirectController],
  providers: [
    WaFormsRepository,
    WaFormsService,
    WaChatLinksRepository,
    WaChatLinksService,
    WaLinkRedirectThrottle,
  ],
})
export class FormsLinksGroupsModule {}
