import { Module } from '@nestjs/common';
import { HttpInstagramBridgeFactory } from '../../infra/providers/channel-instagram/http-instagram-bridge.client';
import { INSTAGRAM_BRIDGE } from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { NoInstagramAutomation, OpenInstagramPlanGate } from './_shims/open-gates';
import { SqlInstagramIngest } from './_shims/sql-instagram-ingest';
import { INSTAGRAM_AUTOMATION, INSTAGRAM_INBOX_INGEST, INSTAGRAM_PLAN_GATE } from './_shims/tokens';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { InboundService } from './inbound.service';
import { InstaflowPublicController } from './inbound.controller';
import { IngestService } from './ingest.service';
import { PullService } from './pull.service';

/**
 * The Instagram channel (IG), through the engine bridge. The shims below stand in for services other domains own; each is replaced
 * by binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [AddonsExtensionRegistryModule],
  controllers: [AccountsController, InstaflowPublicController],
  providers: [
    AccountsService,
    AccountsRepository,
    InboundService,
    IngestService,
    PullService,
    HttpInstagramBridgeFactory,
    { provide: INSTAGRAM_BRIDGE, useExisting: HttpInstagramBridgeFactory },
    { provide: INSTAGRAM_PLAN_GATE, useClass: OpenInstagramPlanGate },
    { provide: INSTAGRAM_INBOX_INGEST, useClass: SqlInstagramIngest },
    { provide: INSTAGRAM_AUTOMATION, useClass: NoInstagramAutomation },
  ],
  exports: [AccountsService, AccountsRepository, IngestService, PullService],
})
export class ChannelInstagramModule {}
