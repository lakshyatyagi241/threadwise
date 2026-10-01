import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { BroadcastDispatchService } from './broadcast-dispatch.service';
import { BroadcastInboxMirrorService } from './broadcast-inbox-mirror.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { EngineSenderRegistry, WabaEngineSender } from './engine-senders';
import { BroadcastsController } from './broadcasts.controller';
import { LinkRedirectController } from './tracking/link-redirect.controller';
import { LinkRedirectService } from './tracking/link-redirect.service';
import { LinkTracker } from './tracking/link-tracker';
import {
  CapTally,
  DefaultPacingSettings,
  PACING_SETTINGS,
  PacingRuntime,
  SenderLease,
} from './send-safety';
import { BroadcastReceiptsService } from './broadcast-receipts.service';
import { BroadcastsActionsController } from './broadcasts-actions.controller';
import { BroadcastsActionsService } from './broadcasts-actions.service';
import { BroadcastsReadController } from './broadcasts-read.controller';
import { BroadcastsReadRepository } from './broadcasts-read.repository';
import { BroadcastsReadService } from './broadcasts-read.service';
import { BroadcastsRepository } from './broadcasts.repository';
import { BroadcastsService } from './broadcasts.service';
import { OpenBroadcastPlanGate, OpenWalletGate, OpenWarmerGate } from './_shims/open-gates';
import { SqlSenderDirectory } from './_shims/sql-sender-directory';
import { SqlTemplateDirectory } from './_shims/sql-template-directory';
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
  imports: [PlansCoreModule, CrmModule],
  controllers: [
    BroadcastsController,
    BroadcastsReadController,
    BroadcastsActionsController,
    LinkRedirectController,
  ],
  exports: [
    BroadcastProgressService,
    BroadcastDispatchService,
    EngineSenderRegistry,
    BroadcastsRepository,
  ],
  providers: [
    CryptoService,
    BroadcastsService,
    BroadcastsRepository,
    BroadcastsReadService,
    BroadcastsActionsService,
    BroadcastReceiptsService,
    BroadcastInboxMirrorService,
    LinkTracker,
    PacingRuntime,
    CapTally,
    SenderLease,
    { provide: PACING_SETTINGS, useClass: DefaultPacingSettings },
    LinkRedirectService,
    BroadcastsReadRepository,
    BroadcastProgressService,
    BroadcastDispatchService,
    WabaEngineSender,
    EngineSenderRegistry,
    { provide: SENDER_DIRECTORY, useClass: SqlSenderDirectory },
    { provide: TEMPLATE_DIRECTORY, useClass: SqlTemplateDirectory },
    { provide: WALLET_GATE, useClass: OpenWalletGate },
    { provide: WARMER_GATE, useClass: OpenWarmerGate },
    { provide: BROADCAST_PLAN_GATE, useClass: OpenBroadcastPlanGate },
  ],
})
export class BroadcastsModule {}
