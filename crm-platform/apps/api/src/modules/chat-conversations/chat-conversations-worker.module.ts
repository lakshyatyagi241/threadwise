import { Module } from '@nestjs/common';
import { ChatMediaModule } from '../../infra/providers/chat-conversations/media';
import { UploadPolicyService } from '../auth';
import { MediaStorageService, PlatformSettingsModule } from '../platform-settings-branding-storage';
import { ChannelIngestProcessor } from './channel-ingest.processor';
import { ChatConversationsModule } from './chat-conversations.module';
import { MessageDispatchProcessor } from './message-dispatch.processor';
import { QueuedMessageRecoveryService } from './queued-message-recovery.service';

/**
 * The message pipelines' workers: the ingest processor (`webhook-ingest`: inbound messages and delivery receipts), the send processor
 * (`message-dispatch`) and the recovery sweep for messages whose send never started. Imported ONLY by WorkersModule (the worker
 * process): the HTTP app stores and enqueues, but must never pick up a job.
 *
 * Inbound media is stored by the ingest job, so the worker registers the same chat media door the HTTP app does (`ChatMediaModule`, over
 * the platform's storage settings and upload policy); the media route it brings along is never reached, a worker has no HTTP listener.
 */
@Module({
  imports: [
    ChatConversationsModule,
    ChatMediaModule.register({
      imports: [PlatformSettingsModule],
      objectGateway: { useExisting: MediaStorageService },
      uploadValidator: { useExisting: UploadPolicyService },
    }),
  ],
  providers: [ChannelIngestProcessor, MessageDispatchProcessor, QueuedMessageRecoveryService],
})
export class ChatConversationsWorkerModule {}
