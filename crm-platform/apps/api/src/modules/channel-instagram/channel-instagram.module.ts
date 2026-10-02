import { Module } from '@nestjs/common';
import { HttpInstagramBridgeFactory } from '../../infra/providers/channel-instagram/http-instagram-bridge.client';
import { INSTAGRAM_BRIDGE } from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import {
  NoInstagramAutomation,
  OpenInstagramPlanGate,
  PublicOnlyMediaUrls,
} from './_shims/open-gates';
import { SqlInstagramIngest } from './_shims/sql-instagram-ingest';
import { SqlInstagramTemplates } from './_shims/sql-instagram-templates';
import {
  INSTAGRAM_AUTOMATION,
  INSTAGRAM_INBOX_INGEST,
  INSTAGRAM_MEDIA_URLS,
  INSTAGRAM_PLAN_GATE,
  INSTAGRAM_TEMPLATES,
} from './_shims/tokens';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastsService } from './broadcasts.service';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { InboundService } from './inbound.service';
import { InstaflowPublicController } from './inbound.controller';
import { IngestService } from './ingest.service';
import { PullService } from './pull.service';
import { SenderService } from './sender.service';

/**
 * The Instagram channel (IG), through the engine bridge. The shims below stand in for services other domains own; each is replaced
 * by binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [AddonsExtensionRegistryModule],
  controllers: [
    AccountsController,
    BroadcastsController,
    FlowsController,
    InstaflowPublicController,
  ],
  providers: [
    AccountsService,
    AccountsRepository,
    InboundService,
    IngestService,
    PullService,
    FlowsService,
    BroadcastsService,
    SenderService,
    HttpInstagramBridgeFactory,
    { provide: INSTAGRAM_BRIDGE, useExisting: HttpInstagramBridgeFactory },
    { provide: INSTAGRAM_PLAN_GATE, useClass: OpenInstagramPlanGate },
    { provide: INSTAGRAM_INBOX_INGEST, useClass: SqlInstagramIngest },
    { provide: INSTAGRAM_AUTOMATION, useClass: NoInstagramAutomation },
    { provide: INSTAGRAM_MEDIA_URLS, useClass: PublicOnlyMediaUrls },
    { provide: INSTAGRAM_TEMPLATES, useClass: SqlInstagramTemplates },
  ],
  exports: [AccountsService, AccountsRepository, IngestService, PullService, SenderService],
})
export class ChannelInstagramModule {}
