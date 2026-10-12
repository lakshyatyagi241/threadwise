import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { GmailClient, GoogleMailOAuthClient } from '../../infra/providers/channel-email';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { EmailAttachmentsController } from './email-attachments.controller';
import { EmailChannelAdapter } from './email-channel.adapter';
import { MailCallbackController } from './mail-callback.controller';
import { MailChannelSync } from './mail-channel.sync';
import { GoogleMailConfig } from './mail-config.service';
import { MailConnectService } from './mail-connect.service';
import { MailIngestService } from './mail-ingest.service';
import { MailPlan } from './mail-plan';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MailSyncService } from './mail-sync.service';
import { MailTokens } from './mail-tokens.service';
import { MailboxesController } from './mailboxes.controller';
import { MailboxesRepository } from './mailboxes.repository';
import { MailboxesService } from './mailboxes.service';

/**
 * The Email channel (MAIL): Gmail mailboxes connected to the team inbox, several per workspace, one inbox channel (kind `email`) each.
 * Connect by Google OAuth, sync with the Gmail API, reply through it. Imported by the API (the hub's routes, the OAuth callback, the
 * attachment download) and by the worker (through ChannelEmailWorkerModule: the sync job, and the adapter the send pipeline needs).
 */
@Module({
  imports: [ChatConversationsModule, PlatformSettingsModule, PlansCoreModule],
  controllers: [MailboxesController, MailCallbackController, EmailAttachmentsController],
  providers: [
    CryptoService,
    GoogleMailOAuthClient,
    GmailClient,
    GoogleMailConfig,
    MailPlan,
    MailboxesRepository,
    MailChannelSync,
    MailTokens,
    MailConnectService,
    MailboxesService,
    MailSyncPublisher,
    MailIngestService,
    MailSyncService,
    EmailChannelAdapter,
  ],
  // The worker module's sweep and processor are built from these.
  exports: [
    MailboxesService,
    MailSyncService,
    MailTokens,
    MailPlan,
    MailboxesRepository,
    GoogleMailConfig,
    MailSyncPublisher,
  ],
})
export class ChannelEmailModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly email: EmailChannelAdapter,
  ) {}

  /** A mailbox is an inbox channel (kind `email`); the send pipeline finds its adapter through the registry. */
  onModuleInit(): void {
    this.channels.register(this.email);
  }
}
