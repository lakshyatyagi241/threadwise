import { Module, type OnModuleInit } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MAIL_DRIVER_PROVIDERS } from './drivers/driver-providers';
import { MailDriverRegistry } from './drivers/mail-driver.registry';
import { BroadcastsModule, EngineSenderRegistry } from '../broadcasts';
import { ChannelAdapterRegistry, ChatConversationsModule } from '../chat-conversations';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { EmailTemplatesModule } from '../email-templates';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { EmailAttachmentsController } from './email-attachments.controller';
import { EmailChannelAdapter } from './email-channel.adapter';
import { EmailEngineSender } from './email-engine.sender';
import { MailBounceHandler } from './mail-bounce.handler';
import { MailCallbackController } from './mail-callback.controller';
import { MailChannelSync } from './mail-channel.sync';
import { GoogleMailConfig } from './mail-config.service';
import { MailConnectService } from './mail-connect.service';
import { MailIngestService } from './mail-ingest.service';
import { MailOutboundPreparer } from './mail-outbound.preparer';
import { MailPlan } from './mail-plan';
import { MailSendGuard } from './mail-send.guard';
import { MAIL_EXTRA_CONTROLLERS, MAIL_EXTRA_EXPORTS, MAIL_EXTRA_PROVIDERS } from './module-parts';
import { MailSyncPublisher } from './mail-sync.publisher';
import { MailSyncService } from './mail-sync.service';
import { MailTokens } from './mail-tokens.service';
import { MailboxesController, MailProvidersController } from './mailboxes.controller';
import { MailboxesRepository } from './mailboxes.repository';
import { MailboxesService } from './mailboxes.service';

/**
 * The Email channel (MAIL): mailboxes connected to the team inbox, several per workspace, one inbox channel (kind `email`) each. Every
 * provider is a `MailDriver` registered in `drivers/driver-providers.ts`; connect, sync and reply go through the `MailDriverRegistry`. Imported by the API (the hub's routes, the OAuth callback, the
 * attachment download) and by the worker (through ChannelEmailWorkerModule: the sync job, and the adapter the send pipeline needs).
 */
@Module({
  imports: [
    BroadcastsModule,
    ChatConversationsModule,
    ContactConsentModule,
    CrmModule,
    EmailTemplatesModule,
    PlatformSettingsModule,
    PlansCoreModule,
  ],
  controllers: [
    MailboxesController,
    MailProvidersController,
    MailCallbackController,
    EmailAttachmentsController,
    ...MAIL_EXTRA_CONTROLLERS,
  ],
  providers: [
    CryptoService,
    ...MAIL_DRIVER_PROVIDERS,
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
    EmailEngineSender,
    MailOutboundPreparer,
    MailSendGuard,
    MailBounceHandler,
    ...MAIL_EXTRA_PROVIDERS,
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
    MailDriverRegistry,
    ...MAIL_EXTRA_EXPORTS,
  ],
})
export class ChannelEmailModule implements OnModuleInit {
  constructor(
    private readonly channels: ChannelAdapterRegistry,
    private readonly email: EmailChannelAdapter,
    private readonly engines: EngineSenderRegistry,
    private readonly campaigns: EmailEngineSender,
  ) {}

  /**
   * A mailbox is an inbox channel (kind `email`); the send pipeline finds its adapter through the registry. It is also an engine
   * (`email:<mailbox uuid>`) that campaigns send through, registered here in the API and, through the worker module, in the worker.
   */
  onModuleInit(): void {
    this.channels.register(this.email);
    this.engines.register('email', this.campaigns);
  }
}
