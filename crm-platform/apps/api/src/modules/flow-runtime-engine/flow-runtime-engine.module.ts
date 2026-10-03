import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SafeFetch } from '../../infra/providers/node-bridge-runtime/safe-fetch';
import { ChatConversationsModule } from '../chat-conversations';
import { PlansCoreModule } from '../plans-subscriptions-trials';
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
  imports: [ChatConversationsModule, PlansCoreModule],
  controllers: [FlowRuntimeController, FlowRuntimePublicController],
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
    CampaignFlowStarterImpl,
  ],
  exports: [
    FlowEngine,
    FlowLaunchService,
    FlowTriggerService,
    FlowRuntimeService,
    RunRepository,
    FlowRunPublisher,
    CampaignFlowStarterImpl,
  ],
})
export class FlowRuntimeEngineModule {}
