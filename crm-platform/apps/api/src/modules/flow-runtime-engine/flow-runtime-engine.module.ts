import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SafeFetch } from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { ChatConversationsModule } from '../chat-conversations';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { ApiKeyGuard } from '../public-api';
import { CapTally, PacingRuntime } from './caps';
import { FlowRuntimeController } from './flow-runtime.controller';
import { FlowRuntimePublicController } from './flow-runtime-public.controller';
import { FlowRuntimeService } from './flow-runtime.service';
import { CampaignFlowStarterImpl } from './runtime/campaign-flow-starter';
import { FlowEngine } from './runtime/engine.service';
import { FlowRunPublisher } from './runtime/flow-run.publisher';
import { FlowSender } from './runtime/flow-sender.service';
import { FlowLaunchService } from './runtime/launch.service';
import { RunRepository } from './runtime/run.repository';
import { SubscriberRepository } from './runtime/subscriber.repository';
import { FlowTriggerService } from './triggers/trigger.service';
import { FLOW_NODE_EXECUTORS } from './runtime/node-executors';
import { ActionNodes } from './runtime/nodes/actions/actions-nodes';
import { ActionNodesModule } from './runtime/nodes/actions/actions-nodes.module';
import { AskInputNode } from './runtime/nodes/actions/ask-input-node';
import { AskMediaNodes } from './runtime/nodes/actions/ask-media-nodes';
import { CrmNodes } from './runtime/nodes/crm/crm-nodes';
import { SocialHandoffNode } from './runtime/nodes/actions/social-handoff-node';
import { AiNodes } from './runtime/nodes/ai/ai-nodes';
import { AiNodesModule } from './runtime/nodes/ai/ai-nodes.module';
import { FaqNodes } from './runtime/nodes/ai/faq-node';
import { OrderingFlowController } from './runtime/nodes/ai/ordering.controller';
import { CommerceNodes } from './runtime/nodes/commerce/commerce-nodes';
import { CommerceNodesModule } from './runtime/nodes/commerce/commerce-nodes.module';
import { GoogleFormWebhookController } from './runtime/nodes/integrations/google-form-webhook.controller';
import { GoogleFormWebhookService } from './runtime/nodes/integrations/google-form-webhook.service';
import { ApiLibraryNodes } from './runtime/nodes/integrations/api-library-node';
import { IntegrationNodes } from './runtime/nodes/integrations/integrations-nodes';
import { IntegrationNodesModule } from './runtime/nodes/integrations/integrations-nodes.module';

/**
 * The flow runtime engine (FLR): runs a flow after the editor saved it. This module holds what the HTTP app and the worker share: the
 * run store, the engine, the launch door, the triggers, the management API for enrolment, runs, retries and numbers, and the API-key
 * routes. What only the worker runs (the step processor, the sweeper, the inbound listener, the event consumer) is in
 * `FlowRuntimeEngineWorkerModule`.
 *
 * The flows themselves (the `flows` table and its editor) belong to the flow builder domain; this module reads them and never
 * writes one.
 *
 * Kernel services (audit, outbox, RBAC), the database, Redis, the queues and the chat media door are global.
 */
@Module({
  imports: [
    ChatConversationsModule,
    PlansCoreModule,
    WalletMessageBillingModule,
    CrmModule,
    ActionNodesModule,
    AiNodesModule,
    CommerceNodesModule,
    IntegrationNodesModule,
  ],
  controllers: [
    FlowRuntimeController,
    FlowRuntimePublicController,
    GoogleFormWebhookController,
    OrderingFlowController,
  ],
  providers: [
    CryptoService,
    ApiKeyGuard,
    SafeFetch,
    CapTally,
    PacingRuntime,
    RunRepository,
    SubscriberRepository,
    FlowRunPublisher,
    FlowSender,
    FlowEngine,
    FlowLaunchService,
    FlowTriggerService,
    FlowRuntimeService,
    GoogleFormWebhookService,
    CampaignFlowStarterImpl,
    {
      provide: FLOW_NODE_EXECUTORS,
      useFactory: (...groups: unknown[]) => groups,
      inject: [
        ActionNodes,
        AskMediaNodes,
        AskInputNode,
        SocialHandoffNode,
        CrmNodes,
        AiNodes,
        FaqNodes,
        CommerceNodes,
        IntegrationNodes,
        ApiLibraryNodes,
      ],
    },
  ],
  exports: [
    FlowEngine,
    FlowLaunchService,
    FlowTriggerService,
    FlowRuntimeService,
    RunRepository,
    FlowRunPublisher,
    CampaignFlowStarterImpl,
    GoogleFormWebhookService,
  ],
})
export class FlowRuntimeEngineModule {}
