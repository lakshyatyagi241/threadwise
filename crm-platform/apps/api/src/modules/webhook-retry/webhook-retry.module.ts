import { Global, Module } from '@nestjs/common';
import { WebhookRetryService } from './webhook-retry.service';

/** Global so each channel module can inject the service without importing this module (it only needs the queue the QueueModule registers). */
@Global()
@Module({ providers: [WebhookRetryService], exports: [WebhookRetryService] })
export class WebhookRetryModule {}
