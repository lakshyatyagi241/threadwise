import { Module } from '@nestjs/common';
import { WebhookRetryModule } from './webhook-retry.module';
import { WebhookRetryProcessor } from './webhook-retry.processor';

/** The webhook retry consumer. Imported ONLY by WorkersModule: the HTTP app queues events but must never work them. */
@Module({ imports: [WebhookRetryModule], providers: [WebhookRetryProcessor] })
export class WebhookRetryWorkerModule {}
