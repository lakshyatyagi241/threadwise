import { Module } from '@nestjs/common';
import { FLOW_AI_PORT } from '../../infra/providers/flow-runtime-engine/flow-ai.port';
import { HttpFlowAiAdapter } from '../../infra/providers/flow-runtime-engine/http-flow-ai.adapter';
import { RealtimeEmitterModule } from '../../realtime';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { BriefFactsService } from './brief-facts.service';
import { CompanyBriefsController } from './company-briefs.controller';
import { CompanyBriefsRepository } from './company-briefs.repository';
import { CompanyBriefsService } from './company-briefs.service';

/**
 * "Generate brief" for a company (BL-194; Reference's Client Brief). Reads the CRM as the person who asks (CrmModule's services, their
 * record scopes), writes with the workspace's own AI key setup (AiKeysUsageAdminModule) through the single-completion port the flow AI
 * node uses, and stores one brief per company and person. `CompanyBriefsService` is also what the AI CRM Copilot's `generate_brief`
 * tool calls.
 */
@Module({
  imports: [AiKeysUsageAdminModule, CrmModule, PlansCoreModule, RealtimeEmitterModule],
  controllers: [CompanyBriefsController],
  providers: [
    CompanyBriefsRepository,
    BriefFactsService,
    CompanyBriefsService,
    { provide: FLOW_AI_PORT, useClass: HttpFlowAiAdapter },
  ],
  exports: [CompanyBriefsService],
})
export class CompanyBriefsModule {}
