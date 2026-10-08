import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../../../chat-conversations';
import { CrmModule } from '../../../crm';
import { FlowRuntimeEngineModule } from '../../../flow-runtime-engine';
import { MessageTemplatesModule } from '../../../message-templates';
import { WabaModule } from '../../../whatsapp-cloud-api-waba';
import { FlowsV1Repository } from './flows/flows.v1.repository';
import { V1FlowsController } from './flows/flows.v1.controller';
import { V1FlowsService } from './flows/flows.v1.service';
import { V1TemplatesController } from './templates/templates.v1.controller';
import { V1TemplatesService } from './templates/templates.v1.service';

/**
 * Customer REST API v1, automation group: templates (`/api/v1/templates`) and flows (`/api/v1/flows`). Both are thin doors onto the
 * domains' own services. Auto-replies (TW-API-038 to 043) are not here: that domain has only a schema so far.
 */
@Module({
  imports: [
    MessageTemplatesModule,
    FlowRuntimeEngineModule,
    ChatConversationsModule,
    CrmModule,
    WabaModule,
  ],
  controllers: [V1TemplatesController, V1FlowsController],
  providers: [V1TemplatesService, V1FlowsService, FlowsV1Repository],
})
export class V1AutomationModule {}
