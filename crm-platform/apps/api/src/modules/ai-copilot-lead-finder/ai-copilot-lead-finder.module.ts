import { Module } from '@nestjs/common';
import { AiCrmProviderModule } from '../../infra/providers/ai-copilot-lead-finder/ai-crm-provider.module';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { ChatConversationsModule } from '../chat-conversations';
import { CompanyBriefsModule } from '../company-briefs';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WorkspacesTeamsTenancyModule } from '../workspaces-teams-tenancy';
import { AiCrmActionsRepository } from './ai-crm-actions.repository';
import { AiCrmController } from './ai-crm.controller';
import { AiCrmCopilotService } from './ai-crm-copilot.service';
import { AiCrmToolkitService } from './ai-crm-toolkit.service';

/**
 * ai-copilot-lead-finder (AICRM): the AI CRM Copilot chat
 * (docs/threadwise-port/inventory/ai-copilot-lead-finder.md). Lead Finder, the domain's other Reference feature, is
 * a separate, not-yet-started unit of work and has no code here.
 */
@Module({
  imports: [
    PlansCoreModule,
    AiCrmProviderModule,
    AiKeysUsageAdminModule,
    CrmModule,
    CompanyBriefsModule,
    ChatConversationsModule,
    WorkspacesTeamsTenancyModule,
  ],
  controllers: [AiCrmController],
  providers: [AiCrmActionsRepository, AiCrmToolkitService, AiCrmCopilotService],
})
export class AiCopilotLeadFinderModule {}
