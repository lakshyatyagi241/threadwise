import { Module } from '@nestjs/common';
import { MessageTemplatesModule } from './message-templates.module';
import { TemplateSweepProcessor, TemplateSweepScheduler } from './template-sweep.processor';

/** The stale-status sweep. Imported ONLY by WorkersModule: the HTTP app never queues or works it. */
@Module({
  imports: [MessageTemplatesModule],
  providers: [TemplateSweepScheduler, TemplateSweepProcessor],
})
export class MessageTemplatesWorkerModule {}
