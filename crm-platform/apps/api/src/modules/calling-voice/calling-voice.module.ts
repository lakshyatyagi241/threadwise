import { Module } from '@nestjs/common';
import { CallingGraphClient, CALLING_GRAPH } from '../../infra/providers/calling-voice';
import { ChatConversationsModule } from '../chat-conversations';
import { ContactConsentModule } from '../contact-consent';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WabaModule } from '../whatsapp-cloud-api-waba';
import { CallActionsService } from './call-actions.service';
import { CallLogsController } from './call-logs.controller';
import { CallLogsRepository } from './call-logs.repository';
import { CallLogsService } from './call-logs.service';
import { CallEventsService } from './call-events.service';
import { CallPermissionService } from './call-permission.service';
import { CallRecordingConsentService } from './call-recording-consent.service';
import { CallRecordingRepository } from './call-recording.repository';
import { CallRecordingSettingsService } from './call-recording-settings.service';
import { CallRecordingsService } from './call-recordings.service';
import { CallingNumbersService } from './calling-numbers.service';
import { CallingWabaSink } from './calling-waba.sink';
import { CallingWebhookController } from './calling-webhook.controller';
import { CallingController } from './calling.controller';
import { CallsRepository } from './calls.repository';

/**
 * WhatsApp calling (CALL): the calling switch per number, the customer's call permission, placing and answering calls from the
 * browser, and the record of every call. It reads and writes through the WABA domain's connections (`WabaConnectService`) and its
 * webhook, and records call bubbles through the inbox facade; Meta's calls API sits behind `CALLING_GRAPH`.
 *
 * What the HTTP app and the worker share is here; the end of the WABA webhook that runs in the worker is bound by
 * `CallingVoiceWorkerModule`.
 *
 * Kernel services (audit, outbox, RBAC), the database, Redis, the queues, the WhatsApp HTTP client and the chat media door are global.
 */
@Module({
  imports: [ChatConversationsModule, ContactConsentModule, WabaModule, PlansCoreModule],
  controllers: [CallingController, CallLogsController, CallingWebhookController],
  providers: [
    CallingGraphClient,
    { provide: CALLING_GRAPH, useExisting: CallingGraphClient },
    CallsRepository,
    CallLogsRepository,
    CallLogsService,
    CallingNumbersService,
    CallPermissionService,
    CallActionsService,
    CallEventsService,
    CallRecordingsService,
    CallRecordingRepository,
    CallRecordingSettingsService,
    CallRecordingConsentService,
    CallingWabaSink,
  ],
  exports: [CallsRepository, CallRecordingRepository, CallingWabaSink, CallActionsService, CallPermissionService, CallEventsService],
})
export class CallingVoiceModule {}
