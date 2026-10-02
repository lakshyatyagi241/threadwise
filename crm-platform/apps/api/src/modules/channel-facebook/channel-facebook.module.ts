import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FACEBOOK_GRAPH } from '../../infra/providers/channel-facebook/facebook.port';
import { FacebookGraphClients } from '../../infra/providers/channel-facebook/facebook-graph.client';
import { NoInboundHooks, OpenFacebookPlanGate, PublicOnlyMediaUrls } from './_shims/open-gates';
import { SqlFacebookTemplates } from './_shims/sql-facebook-templates';
import { SqlInboxIngest } from './_shims/sql-inbox-ingest';
import {
  FACEBOOK_PLAN_GATE,
  FACEBOOK_TEMPLATES,
  INBOUND_HOOKS,
  INBOX_INGEST,
  MEDIA_URLS,
} from './_shims/tokens';
import { BackfillService } from './backfill.service';
import { FbBroadcastSenderService } from './fb-broadcast-sender.service';
import { FbBroadcastsController } from './fb-broadcasts.controller';
import { FbBroadcastsRepository } from './fb-broadcasts.repository';
import { FbBroadcastsService } from './fb-broadcasts.service';
import { InboundService } from './inbound.service';
import { PagesController } from './pages.controller';
import { PagesRepository } from './pages.repository';
import { PagesService } from './pages.service';
import { SenderService } from './sender.service';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import { FacebookPublicController } from './webhook.controller';

/**
 * The Facebook Pages channel (FB). The shims below stand in for services other domains own; each is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  controllers: [PagesController, FbBroadcastsController, SetupController, FacebookPublicController],
  providers: [
    CryptoService,
    PagesService,
    PagesRepository,
    InboundService,
    BackfillService,
    SenderService,
    FbBroadcastsService,
    FbBroadcastsRepository,
    FbBroadcastSenderService,
    SetupService,
    FacebookGraphClients,
    { provide: FACEBOOK_GRAPH, useExisting: FacebookGraphClients },
    { provide: FACEBOOK_PLAN_GATE, useClass: OpenFacebookPlanGate },
    { provide: INBOX_INGEST, useClass: SqlInboxIngest },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
    { provide: FACEBOOK_TEMPLATES, useClass: SqlFacebookTemplates },
    { provide: MEDIA_URLS, useClass: PublicOnlyMediaUrls },
  ],
  exports: [
    PagesService,
    PagesRepository,
    BackfillService,
    SenderService,
    FbBroadcastSenderService,
  ],
})
export class ChannelFacebookModule {}
