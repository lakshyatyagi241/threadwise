import { Module } from '@nestjs/common';
import { MessageTemplatesModule } from './message-templates.module';
import { TemplateConnectSyncConsumer } from './template-connect-sync.consumer';
import { TemplateSweepProcessor, TemplateSweepScheduler } from './template-sweep.processor';

/** The stale-status sweep and the sync after a number connects. Imported ONLY by WorkersModule: the HTTP app never queues or works it. */
@Module({
  imports: [MessageTemplatesModule],
  providers: [TemplateSweepScheduler, TemplateSweepProcessor, TemplateConnectSyncConsumer],
})
export class MessageTemplatesWorkerModule {}
