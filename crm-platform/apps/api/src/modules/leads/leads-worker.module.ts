import { Module } from '@nestjs/common';
import { BroadcastsModule } from '../broadcasts';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';
import { ChatConversationsModule } from '../chat-conversations';
import { CrmModule } from '../crm';
import { EmailTemplatesModule } from '../email-templates';
import { MessageTemplatesModule } from '../message-templates';
import { NotificationPublisher, NotificationsRepository } from '../notifications';
import { LeadFirstMessageLookups } from './lead-first-message.lookups';
import { LeadFirstMessageSender } from './lead-first-message.sender';
import { LeadFirstRepliesRepository } from './lead-first-replies.repository';
import { LeadFirstReplyConsumer } from './lead-first-reply.consumer';
import { LeadFirstReplyService } from './lead-first-reply.service';
import { LeadFirstReplySweepService } from './lead-first-reply.sweep';
import { LeadIngestModule } from './lead-ingest.module';
import { LeadPullModule } from './lead-pull.module';
import { LeadNotificationConsumer } from './lead-notification.consumer';
import { LeadRetentionSweepService } from './lead-retention-sweep.service';
import { LeadSyncRunsRepository } from './lead-sync-runs.repository';
import { LeadSyncService } from './lead-sync.service';
import { LeadSyncProcessor, LeadSyncSweepService } from './lead-sync.worker';

/**
 * The outbox consumers that notify people of a new lead and send it a first message (speed-to-lead, BL-014), and the sweeps that purge raw
 * payloads past their retention, work through the first messages that have come due, and run the pulls of "Sync now" and backfill (the lead inbox, L-18). Imported ONLY by
 * WorkersModule (the worker process): a consumer registers itself with the kernel's OutboxSubscriberRegistry, which the drain loop in that
 * process fans events out to, and an API pod that also swept would multiply the polling load on the database.
 */
@Module({
  imports: [
    LeadIngestModule,
    LeadPullModule,
    CrmModule,
    ContactConsentModule,
    SendWindowModule,
    ChatConversationsModule,
    BroadcastsModule,
    MessageTemplatesModule,
    EmailTemplatesModule,
  ],
  providers: [
    NotificationsRepository,
    NotificationPublisher,
    LeadNotificationConsumer,
    LeadRetentionSweepService,
    LeadFirstMessageLookups,
    LeadFirstRepliesRepository,
    LeadFirstMessageSender,
    LeadFirstReplyService,
    LeadFirstReplyConsumer,
    LeadFirstReplySweepService,
    LeadSyncRunsRepository,
    LeadSyncService,
    LeadSyncProcessor,
    LeadSyncSweepService,
  ],
})
export class LeadsWorkerModule {}
