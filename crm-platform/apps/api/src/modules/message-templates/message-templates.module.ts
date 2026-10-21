import { Module } from '@nestjs/common';
import { AiKeysUsageAdminModule } from '../ai-keys-usage-admin';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WabaModule } from '../whatsapp-cloud-api-waba';
import { TemplateAiController } from './template-ai.controller';
import { TemplateAiService } from './template-ai.service';
import { TemplateSyncService } from './template-sync.service';
import { TemplatesController } from './templates.controller';
import { TemplatesRepository } from './templates.repository';
import { TemplatesService } from './templates.service';

/**
 * WhatsApp message templates (TPL). Provider access (Meta Graph, Interakt) is the global `WabaProvidersModule`; the audit and
 * outbox services, RBAC, the database and the upload guard (AuthModule) are global too. The number a template is sent through
 * comes from `WabaModule`.
 */
import { PlatformSettingsModule } from '../platform-settings-branding-storage';

@Module({
  imports: [WabaModule, PlansCoreModule, AiKeysUsageAdminModule, PlatformSettingsModule],
  controllers: [TemplatesController, TemplateAiController],
  providers: [TemplatesRepository, TemplatesService, TemplateSyncService, TemplateAiService],
  exports: [TemplatesService, TemplateSyncService, TemplatesRepository],
})
export class MessageTemplatesModule {}
