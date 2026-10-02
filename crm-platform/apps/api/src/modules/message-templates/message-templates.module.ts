import { Module } from '@nestjs/common';
import { WabaModule } from '../whatsapp-cloud-api-waba';
import { TemplateSyncService } from './template-sync.service';
import { TemplatesController } from './templates.controller';
import { TemplatesRepository } from './templates.repository';
import { TemplatesService } from './templates.service';

/**
 * WhatsApp message templates (TPL). Provider access (Meta Graph, Interakt) is the global `WabaProvidersModule`; the audit and
 * outbox services, RBAC, the database and the upload guard (AuthModule) are global too. The number a template is sent through
 * comes from `WabaModule`.
 */
@Module({
  imports: [WabaModule],
  controllers: [TemplatesController],
  providers: [TemplatesRepository, TemplatesService, TemplateSyncService],
  exports: [TemplatesService, TemplateSyncService, TemplatesRepository],
})
export class MessageTemplatesModule {}
