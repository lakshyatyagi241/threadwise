import { Module } from '@nestjs/common';
import {
  AI_AGENT_HANDOFF_PORT,
  UnavailableAiAgentHandoff,
} from '../../../../../infra/providers/flow-runtime-engine/ai-agent-handoff.port';
import { FLOW_AI_PORT } from '../../../../../infra/providers/flow-runtime-engine/flow-ai.port';
import { HttpFlowAiAdapter } from '../../../../../infra/providers/flow-runtime-engine/http-flow-ai.adapter';
import {
  NoOrderGroupNotify,
  NoOrderMedia,
  ORDER_GROUP_NOTIFY_PORT,
  ORDER_MEDIA_PORT,
} from '../../../../../infra/providers/flow-runtime-engine/ordering.port';
import { AiKeysUsageAdminModule } from '../../../../ai-keys-usage-admin';
import { CatalogProductsModule } from '../../../../catalog-products';
import { CrmModule } from '../../../../crm';
import { FaqKnowledgeModule } from '../../../../faq-knowledge';
import { LocalizationTranslationModule } from '../../../../localization-translation';
import { AiCallService } from './ai-call.service';
import { AiNodes } from './ai-nodes';
import { FaqNodes } from './faq-node';
import { OrderingFlowService } from './ordering.service';

/** Imports the domains this node group calls (their public modules only); never the flow runtime module (it imports this one). */
@Module({
  imports: [
    AiKeysUsageAdminModule,
    CatalogProductsModule,
    CrmModule,
    FaqKnowledgeModule,
    LocalizationTranslationModule,
  ],
  providers: [
    AiNodes,
    FaqNodes,
    AiCallService,
    OrderingFlowService,
    { provide: FLOW_AI_PORT, useClass: HttpFlowAiAdapter },
    // Until the AI agents domain provides its own binding, a Chatbot hand-off is refused as unavailable.
    { provide: AI_AGENT_HANDOFF_PORT, useClass: UnavailableAiAgentHandoff },
    // Voice and photo orders, and the group post, wait for their providers (see ordering.port.ts).
    { provide: ORDER_MEDIA_PORT, useClass: NoOrderMedia },
    { provide: ORDER_GROUP_NOTIFY_PORT, useClass: NoOrderGroupNotify },
  ],
  exports: [AiNodes, FaqNodes, AiCallService, OrderingFlowService, AI_AGENT_HANDOFF_PORT],
})
export class AiNodesModule {}
