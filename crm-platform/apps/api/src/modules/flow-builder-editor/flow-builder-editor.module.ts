import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { FLOW_AI_PORT } from '../../infra/providers/flow-builder-editor/flow-ai.port';
import { FLOW_MEDIA_STORE } from '../../infra/providers/flow-builder-editor/flow-media.port';
import { HttpFlowAiAdapter } from '../../infra/providers/flow-builder-editor/http-flow-ai.adapter';
import { LocalFlowMediaAdapter } from '../../infra/providers/flow-builder-editor/local-flow-media.adapter';
import { FlowRuntimeEngineModule } from '../flow-runtime-engine';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { BuilderContextService } from './builder-context.service';
import { FlowAiService } from './flow-ai.service';
import { FlowMediaController } from './flow-media.controller';
import { FlowMediaService } from './flow-media.service';
import { FlowReaderService } from './flow-reader.service';
import { FlowTemplatesAdminService } from './flow-templates-admin.service';
import { FlowsController } from './flows.controller';
import { FlowsRepository } from './flows.repository';
import { FlowsService } from './flows.service';
import { PlatformFlowTemplatesController } from './platform-flow-templates.controller';
import { TestWebhookService } from './test-webhook.service';

/**
 * Flow builder and editor (FLB): the flows list and its actions, the builder's save / publish / import / export, the
 * template gallery and its operator admin, the builder's reference data, the webhook test and the AI generator. The
 * runtime engine (FLR) is a separate domain: it reads flows only through FlowReaderService.
 *
 * Providers behind ports: FLOW_AI_PORT (vendor HTTP, `infra/providers/flow-builder-editor`) and FLOW_MEDIA_STORE (local disk
 * until object storage lands; see the port's note). No worker jobs live here: nothing in the editor runs in the background.
 */
@Module({
  imports: [PlansCoreModule, PlatformSettingsModule, FlowRuntimeEngineModule],
  controllers: [FlowsController, FlowMediaController, PlatformFlowTemplatesController],
  providers: [
    CryptoService,
    FlowsRepository,
    FlowsService,
    FlowReaderService,
    BuilderContextService,
    FlowAiService,
    FlowMediaService,
    FlowTemplatesAdminService,
    TestWebhookService,
    { provide: FLOW_AI_PORT, useClass: HttpFlowAiAdapter },
    { provide: FLOW_MEDIA_STORE, useClass: LocalFlowMediaAdapter },
  ],
  exports: [FlowsRepository, FlowReaderService],
})
export class FlowBuilderEditorModule {}
