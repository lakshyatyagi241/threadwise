import { Module } from '@nestjs/common';
import { ChatMediaModule } from '../../infra/providers/chat-conversations/media';
import { UploadPolicyService } from '../auth';
import { MediaStorageService, PlatformSettingsModule } from '../platform-settings-branding-storage';
import { ChannelIngestProcessor } from './channel-ingest.processor';
import { ChatConversationsModule } from './chat-conversations.module';
import { MediaFetchProcessor } from './media-fetch.processor';
import { MediaFetchRecoveryService } from './media-fetch-recovery.service';
import { MessageDispatchProcessor } from './message-dispatch.processor';
import { MessageLogArchiveService } from './message-log-archive.service';
import { MessageLogExportProcessor } from './message-log-export.processor';
import { MessageLogExportRunner } from './message-log-export.runner';
import { QueuedMessageRecoveryService } from './queued-message-recovery.service';
import { WabaChannelSyncConsumer } from './waba-channel-sync.consumer';
import { WabaGroupRetitleConsumer } from './waba-group-retitle.consumer';
import { WabaInboxBindingModule } from './waba-inbox-binding.module';

/**
 * The message pipelines' workers: the ingest processor (`webhook-ingest`: inbound messages and delivery receipts), the send processor
 * (`message-dispatch`), the file copier (`media-fetch`: a customer's WhatsApp file is downloaded after its message is stored) and the
 * recovery sweeps for messages whose send never started and for files whose download job was lost, and the keeper of the message
 * delivery log (the daily archive sweep and the export builder, `msg-log-export`). Imported ONLY by WorkersModule (the worker
 * process): the HTTP app stores and enqueues, but must never pick up a job.
 *
 * Inbound media is stored by the ingest job, so the worker registers the same chat media door the HTTP app does (`ChatMediaModule`, over
 * the platform's storage settings and upload policy); the media route it brings along is never reached, a worker has no HTTP listener.
 */
@Module({
  imports: [
    ChatConversationsModule,
    // The WhatsApp webhook worker (`WabaWorkerModule`) hands every inbound message and unclaimed delivery report to the inbox through this.
    WabaInboxBindingModule,
    ChatMediaModule.register({
      imports: [PlatformSettingsModule],
      objectGateway: { useExisting: MediaStorageService },
      uploadValidator: { useExisting: UploadPolicyService },
    }),
  ],
  providers: [
    ChannelIngestProcessor,
    MessageDispatchProcessor,
    QueuedMessageRecoveryService,
    MediaFetchProcessor,
    MediaFetchRecoveryService,
    WabaChannelSyncConsumer,
    WabaGroupRetitleConsumer,
    MessageLogArchiveService,
    MessageLogExportRunner,
    MessageLogExportProcessor,
  ],
})
export class ChatConversationsWorkerModule {}
