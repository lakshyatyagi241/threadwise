import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { WebhookFanoutController } from './webhook-fanout.controller';
import { WebhookFanoutService } from './webhook-fanout.service';
import { WebhookTargetsRepository } from './webhook-targets.repository';
import { WebhookTargetsService } from './webhook-targets.service';

/**
 * Forwards the one Meta webhook to the targets an operator configures. The HTTP side only enqueues (WebhookFanoutService,
 * called by the WhatsApp receiver) and serves the operator screens; delivery runs in WebhookFanoutWorkerModule. The platform
 * door (PlatformStore), audit and the queues come from global modules. Registered in app.module.ts.
 */
@Module({
  controllers: [WebhookFanoutController],
  providers: [CryptoService, WebhookTargetsRepository, WebhookTargetsService, WebhookFanoutService],
  exports: [WebhookFanoutService],
})
export class WebhookFanoutModule {}
