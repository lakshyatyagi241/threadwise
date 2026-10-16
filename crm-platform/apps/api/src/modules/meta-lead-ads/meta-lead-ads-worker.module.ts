import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MetaLeadAdsGraphClient } from '../../infra/providers/meta-lead-ads/meta-lead-ads-graph.client';
import { META_LEAD_ADS_GRAPH } from '../../infra/providers/meta-lead-ads/meta-lead-ads.port';
import { ChannelFacebookModule } from '../channel-facebook';
import { LeadIngestModule } from '../leads';
import { LeadSweepProcessor } from './lead-sweep.processor';
import { LeadSweepService } from './lead-sweep.service';
import { LeadgenProcessor } from './leadgen.processor';
import { LeadgenService } from './leadgen.service';
import { MetaLeadAdsRepository } from './meta-lead-ads.repository';
import { MetaLeadPullBinding, MetaLeadPullProvider } from './meta-lead-pull.provider';
import { MetaLeadPullService } from './meta-lead-pull.service';
import { PageDisconnectConsumer } from './page-disconnect.consumer';

/**
 * The Meta lead ads worker side: the `leadgen` webhook jobs, the reconciliation sweep and the Page-disconnect consumer. Imported ONLY by
 * WorkersModule (the worker process): the HTTP app queues jobs and never runs them, and the outbox consumer registers itself with the
 * subscriber registry that process drains.
 */
@Module({
  imports: [ChannelFacebookModule, LeadIngestModule],
  providers: [
    CryptoService,
    MetaLeadAdsRepository,
    MetaLeadAdsGraphClient,
    { provide: META_LEAD_ADS_GRAPH, useExisting: MetaLeadAdsGraphClient },
    LeadgenService,
    MetaLeadPullService,
    MetaLeadPullProvider,
    MetaLeadPullBinding,
    LeadgenProcessor,
    LeadSweepProcessor,
    LeadSweepService,
    PageDisconnectConsumer,
  ],
})
export class MetaLeadAdsWorkerModule {}
