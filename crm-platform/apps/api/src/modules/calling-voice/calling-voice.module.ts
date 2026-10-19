import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CallingGraphClient, CALLING_GRAPH } from '../../infra/providers/calling-voice';
import { ChatConversationsModule } from '../chat-conversations';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
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
import { CallingReadinessRepository } from './calling-readiness.repository';
import { CallingReadinessService } from './calling-readiness.service';
import { CallingWabaSink } from './calling-waba.sink';
import { CallingWebhookController } from './calling-webhook.controller';
import { CallingController } from './calling.controller';
import { CallsRepository } from './calls.repository';
import { CallIngestService } from './logging/call-ingest.service';
import { CallLogEntriesRepository } from './logging/call-log-entries.repository';
import { CallLogEntriesService } from './logging/call-log-entries.service';
import { CallLoggingController, ContactCallsController } from './logging/call-logging.controller';
import { CallLoggingSettingsService } from './logging/call-logging-settings.service';
import { ClickToCallService } from './logging/click-to-call.service';
import { ContactCallsService } from './logging/contact-calls.service';
import { TelephonyConnectionsService } from './logging/telephony-connections.service';
import { TelephonyWebhookController } from './logging/telephony-webhook.controller';
import { TelephonyWebhookService } from './logging/telephony-webhook.service';

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
  imports: [
    ChatConversationsModule,
    ContactConsentModule,
    CrmModule,
    SendWindowModule,
    WabaModule,
    PlansCoreModule,
  ],
  controllers: [
    CallingController,
    CallLogsController,
    CallingWebhookController,
    CallLoggingController,
    ContactCallsController,
    TelephonyWebhookController,
  ],
  providers: [
    CallingGraphClient,
    { provide: CALLING_GRAPH, useExisting: CallingGraphClient },
    CallsRepository,
    CallLogsRepository,
    CallLogsService,
    CallingNumbersService,
    CallingReadinessRepository,
    CallingReadinessService,
    CallPermissionService,
    CallActionsService,
    CallEventsService,
    CallRecordingsService,
    CallRecordingRepository,
    CallRecordingSettingsService,
    CallRecordingConsentService,
    CallingWabaSink,
    // Call logging: the calls that are not WhatsApp calls (docs/specs/call-logging.md).
    CryptoService,
    CallLogEntriesRepository,
    CallLogEntriesService,
    CallLoggingSettingsService,
    CallIngestService,
    ContactCallsService,
    TelephonyConnectionsService,
    TelephonyWebhookService,
    ClickToCallService,
  ],
  exports: [
    CallLogEntriesRepository,
    CallLogEntriesService,
    CallLoggingSettingsService,
    CallRecordingSettingsService,
    CallsRepository,
    CallRecordingRepository,
    CallingWabaSink,
    CallActionsService,
    CallPermissionService,
    CallEventsService,
    CallingReadinessService,
    CallingReadinessRepository,
  ],
})
export class CallingVoiceModule {}
