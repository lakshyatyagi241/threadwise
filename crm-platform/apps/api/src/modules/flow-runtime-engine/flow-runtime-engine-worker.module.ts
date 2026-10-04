import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { CampaignsModule, CAMPAIGN_FLOW_STARTER, NoFlowStarter } from '../campaigns';
import { ChatConversationsModule } from '../chat-conversations';
import { ShopifyWoocommerceModule } from '../shopify-woocommerce';
import { FlowRuntimeEngineModule } from './flow-runtime-engine.module';
import { CampaignFlowStarterImpl } from './runtime/campaign-flow-starter';
import { CatalogProductsModule } from '../catalog-products';
import { CatalogConciergeListener } from './runtime/nodes/commerce/catalog-concierge.listener';
import { CatalogCartResume, CommerceResume } from './runtime/nodes/commerce/commerce-resume';
import { CommerceNodesModule } from './runtime/nodes/commerce/commerce-nodes.module';
import { FlowRunProcessor } from './runtime/flow-run.processor';
import { FlowSweeperService } from './runtime/flow-sweeper.service';
import { FlowInboundService } from './triggers/inbound.service';
import { FlowTriggerEventsConsumer } from './triggers/trigger-events.consumer';

/**
 * What only the worker runs: the step processor, the sweeper, the listener for inbound messages and the consumer of domain events.
 * Imported ONLY by WorkersModule: an API pod that also swept or processed would multiply the load, and an HTTP pod must never pick
 * up a job. Also binds the flow runtime into the campaigns' flow-starter seam, in the process that runs campaigns.
 */
@Module({
  imports: [
    FlowRuntimeEngineModule,
    ChatConversationsModule,
    CampaignsModule,
    CatalogProductsModule,
    CommerceNodesModule,
    ShopifyWoocommerceModule,
  ],
  providers: [
    FlowRunProcessor,
    FlowSweeperService,
    FlowInboundService,
    FlowTriggerEventsConsumer,
    CommerceResume,
    CatalogCartResume,
    CatalogConciergeListener,
  ],
})
export class FlowRuntimeEngineWorkerModule implements OnModuleInit {
  constructor(
    @Inject(CAMPAIGN_FLOW_STARTER) private readonly campaignGate: NoFlowStarter,
    private readonly campaignStarter: CampaignFlowStarterImpl,
  ) {}

  onModuleInit(): void {
    this.campaignGate.use(this.campaignStarter);
  }
}
