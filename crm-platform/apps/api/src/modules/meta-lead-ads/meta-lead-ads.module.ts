import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MetaLeadAdsGraphClient } from '../../infra/providers/meta-lead-ads/meta-lead-ads-graph.client';
import { META_LEAD_ADS_GRAPH } from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import { ChannelFacebookModule } from '../channel-facebook';
import { LeadIngestModule } from '../leads';
import { LeadgenService } from './leadgen.service';
import { MetaLeadAdsController } from './meta-lead-ads.controller';
import { MetaLeadAdsRepository } from './meta-lead-ads.repository';
import { MetaLeadAdsService } from './meta-lead-ads.service';
import { MetaLeadPullBinding, MetaLeadPullProvider } from './meta-lead-pull.provider';
import { MetaLeadPullService } from './meta-lead-pull.service';

/**
 * Meta lead ads (spec L-06, BL-011): the native door from Facebook and Instagram lead forms into the lead pipeline. The HTTP side: which
 * connected Pages have lead sync on, which lead forms feed the pipeline, and the health of each. It uses the Facebook channel's Pages
 * (their sealed tokens, the Meta app's settings, the login) and the lead pipeline's source directory; receiving the leads is the worker's
 * (`MetaLeadAdsWorkerModule`). The webhook itself is the Facebook channel's, which queues each `leadgen` event for that worker.
 */
@Module({
  imports: [ChannelFacebookModule, LeadIngestModule],
  controllers: [MetaLeadAdsController],
  providers: [
    CryptoService,
    MetaLeadAdsRepository,
    MetaLeadAdsService,
    MetaLeadAdsGraphClient,
    { provide: META_LEAD_ADS_GRAPH, useExisting: MetaLeadAdsGraphClient },
    // "Sync now" and backfill (BL-204): the provider answers what a picked form can do here; the worker runs the pull.
    LeadgenService,
    MetaLeadPullService,
    MetaLeadPullProvider,
    MetaLeadPullBinding,
  ],
})
export class MetaLeadAdsModule {}
