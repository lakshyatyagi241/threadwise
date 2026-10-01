import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { BroadcastDispatchService } from './broadcast-dispatch.service';
import { BroadcastProgressService } from './broadcast-progress.service';
import { EngineSenderRegistry, WabaEngineSender } from './engine-senders';
import { BroadcastsController } from './broadcasts.controller';
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
  controllers: [BroadcastsController],
  exports: [BroadcastProgressService, BroadcastDispatchService, EngineSenderRegistry],
  providers: [
    CryptoService,
    BroadcastsService,
    BroadcastsRepository,
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
