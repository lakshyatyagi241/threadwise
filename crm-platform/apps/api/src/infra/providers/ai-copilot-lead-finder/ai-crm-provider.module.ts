import { Module } from '@nestjs/common';
import { AI_CRM_PROVIDER_PORT } from './ai-crm-provider.port';
import { HttpAiCrmProviderAdapter } from './http-ai-crm-provider.adapter';

/** OpenAI/Anthropic/Gemini tool-calling adapter for the AI CRM Copilot (TW-AICRM-001). */
@Module({
  providers: [HttpAiCrmProviderAdapter, { provide: AI_CRM_PROVIDER_PORT, useExisting: HttpAiCrmProviderAdapter }],
  exports: [AI_CRM_PROVIDER_PORT],
})
export class AiCrmProviderModule {}
