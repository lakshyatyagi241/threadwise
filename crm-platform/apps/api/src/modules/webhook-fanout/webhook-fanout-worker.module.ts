import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { WebhookForwardProcessor } from './webhook-forward.processor';
import { WebhookForwardRetentionService } from './webhook-forward-retention.service';
import { WebhookTargetsRepository } from './webhook-targets.repository';

/** The forward consumer and failure retention. Imported ONLY by WorkersModule: the HTTP app enqueues, the worker delivers. */
@Module({
  providers: [
    CryptoService,
    WebhookTargetsRepository,
    WebhookForwardProcessor,
    WebhookForwardRetentionService,
  ],
})
export class WebhookFanoutWorkerModule {}
