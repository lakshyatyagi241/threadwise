import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FACEBOOK_GRAPH } from '../../infra/providers/channel-facebook/facebook.port';
import { FacebookGraphClients } from '../../infra/providers/channel-facebook/facebook-graph.client';
import { NoInboundHooks, OpenFacebookPlanGate, PublicOnlyMediaUrls } from './_shims/open-gates';
import { SqlInboxIngest } from './_shims/sql-inbox-ingest';
import { FACEBOOK_PLAN_GATE, INBOUND_HOOKS, INBOX_INGEST, MEDIA_URLS } from './_shims/tokens';
import { BackfillService } from './backfill.service';
import { InboundService } from './inbound.service';
import { PagesController } from './pages.controller';
import { PagesRepository } from './pages.repository';
import { PagesService } from './pages.service';
import { SenderService } from './sender.service';
import { FacebookPublicController } from './webhook.controller';

/**
 * The Facebook Pages channel (FB). The shims below stand in for services other domains own; each is replaced by binding the real
 * one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  controllers: [PagesController, FacebookPublicController],
  providers: [
    CryptoService,
    PagesService,
    PagesRepository,
    InboundService,
    BackfillService,
    SenderService,
    FacebookGraphClients,
    { provide: FACEBOOK_GRAPH, useExisting: FacebookGraphClients },
    { provide: FACEBOOK_PLAN_GATE, useClass: OpenFacebookPlanGate },
    { provide: INBOX_INGEST, useClass: SqlInboxIngest },
    { provide: INBOUND_HOOKS, useClass: NoInboundHooks },
    { provide: MEDIA_URLS, useClass: PublicOnlyMediaUrls },
  ],
  exports: [PagesService, PagesRepository, BackfillService, SenderService],
})
export class ChannelFacebookModule {}
