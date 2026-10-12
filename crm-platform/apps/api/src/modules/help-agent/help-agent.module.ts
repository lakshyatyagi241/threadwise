import { Module } from '@nestjs/common';
import { readHelpAgentEnv } from '../../config/domains/help-agent.env';
import { HELP_AGENT_LLM_PORT } from '../../infra/providers/help-agent/help-agent-llm.port';
import {
  HELP_AGENT_ENV,
  HttpHelpAgentLlmAdapter,
} from '../../infra/providers/help-agent/http-help-agent-llm.adapter';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { HelpAgentProxyService } from './help-agent-proxy.service';
import { HelpAgentController } from './help-agent.controller';
import { HelpAgentRepository } from './help-agent.repository';
import { HelpAgentService } from './help-agent.service';

/**
 * The in-app Help assistant (docs/specs/help-agent-assistant.md): its workspace switch, the task budget and audit, and the model proxy
 * that keeps every vendor key on the server. The vendor is behind `HELP_AGENT_LLM_PORT`; the key comes from the AI keys domain and the
 * tokens go to its ledger. Registered in app.module.ts.
 */
@Module({
  imports: [AiKeysUsageAdminModule, PlansCoreModule],
  controllers: [HelpAgentController],
  providers: [
    { provide: HELP_AGENT_ENV, useFactory: () => readHelpAgentEnv() },
    HttpHelpAgentLlmAdapter,
    { provide: HELP_AGENT_LLM_PORT, useExisting: HttpHelpAgentLlmAdapter },
    HelpAgentRepository,
    HelpAgentService,
    HelpAgentProxyService,
  ],
})
export class HelpAgentModule {}
