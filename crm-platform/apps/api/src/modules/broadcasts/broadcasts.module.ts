import { forwardRef, Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SendWindowModule } from '../compliance-center';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { BroadcastDispatchService } from './broadcast-dispatch.service';
import { BroadcastInboxMirrorService } from './broadcast-inbox-mirror.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { EngineSenderRegistry, TransportEngineSender, WabaEngineSender } from './engine-senders';
import { BroadcastsController } from './broadcasts.controller';
import { PreviousSendsService } from './previous-sends';
import { MarketingMediaController } from './marketing-media.controller';
import { MarketingMediaService } from './marketing-media.service';
import { LinkRedirectController } from './tracking/link-redirect.controller';
import { LinkRedirectService } from './tracking/link-redirect.service';
import { LinkTracker } from './tracking/link-tracker';
import {
  CapTally,
  PACING_SETTINGS,
  PlatformPacingSettings,
  PacingRuntime,
  SenderLease,
} from './send-safety';
import { BroadcastReceiptsService } from './broadcast-receipts.service';
import { BroadcastsActionsController } from './broadcasts-actions.controller';
import { BroadcastsActionsService } from './broadcasts-actions.service';
import { BroadcastsReadController } from './broadcasts-read.controller';
import { BroadcastsReadRepository } from './broadcasts-read.repository';
import { BroadcastsComposeService } from './broadcasts-compose.service';
import { BroadcastsReadService } from './broadcasts-read.service';
import { BroadcastsRepository } from './broadcasts.repository';
import { BroadcastsService } from './broadcasts.service';
import { OpenBroadcastPlanGate, OpenWarmerGate } from './_shims/open-gates';
import { SqlSenderDirectory } from './_shims/sql-sender-directory';
import { SqlTemplateDirectory } from './_shims/sql-template-directory';
import { BillingWalletGate } from './_shims/wallet-gate';
import {
  BROADCAST_PLAN_GATE,
  SENDER_DIRECTORY,
  TEMPLATE_DIRECTORY,
  WALLET_GATE,
  WARMER_GATE,
} from './_shims/tokens';

/**
 * WhatsApp broadcasts (BCAST). The shims below stand in for services other domains own; each is replaced by binding
 * the real service to the same token (see _shims/README.md).
 */
@Module({
  // forwardRef: the node bridge reaches broadcasts back through the inbox and WABA.
  imports: [
    PlansCoreModule,
    CrmModule,
    ContactConsentModule,
    SendWindowModule,
    forwardRef(() => NodeBridgeRuntimeModule),
    WalletMessageBillingModule,
    PlatformSettingsModule,
  ],
  controllers: [
    BroadcastsController,
    BroadcastsReadController,
    BroadcastsActionsController,
    LinkRedirectController,
    MarketingMediaController,
  ],
  exports: [
    PreviousSendsService,
    MarketingMediaService,
    BroadcastsService,
    BroadcastsReadService,
    BroadcastReceiptsService,
    BroadcastProgressService,
    BroadcastDispatchService,
    EngineSenderRegistry,
    BroadcastsRepository,
    BroadcastsComposeService,
    LinkTracker,
    PacingRuntime,
    CapTally,
    SenderLease,
    PACING_SETTINGS,
    SENDER_DIRECTORY,
    TEMPLATE_DIRECTORY,
    WALLET_GATE,
    WARMER_GATE,
    BroadcastReceiptsService,
  ],
  providers: [
    MarketingMediaService,
    PreviousSendsService,
    CryptoService,
    BroadcastsService,
    BroadcastsRepository,
    BroadcastsReadService,
    BroadcastsComposeService,
    BroadcastsActionsService,
    BroadcastReceiptsService,
    BroadcastInboxMirrorService,
    LinkTracker,
    PacingRuntime,
    CapTally,
    SenderLease,
    { provide: PACING_SETTINGS, useClass: PlatformPacingSettings },
    LinkRedirectService,
    BroadcastsReadRepository,
    BroadcastProgressService,
    BroadcastDispatchService,
    WabaEngineSender,
    TransportEngineSender,
    EngineSenderRegistry,
    { provide: SENDER_DIRECTORY, useClass: SqlSenderDirectory },
    { provide: TEMPLATE_DIRECTORY, useClass: SqlTemplateDirectory },
    { provide: WALLET_GATE, useClass: BillingWalletGate },
    { provide: WARMER_GATE, useClass: OpenWarmerGate },
    { provide: BROADCAST_PLAN_GATE, useClass: OpenBroadcastPlanGate },
  ],
})
export class BroadcastsModule {}
