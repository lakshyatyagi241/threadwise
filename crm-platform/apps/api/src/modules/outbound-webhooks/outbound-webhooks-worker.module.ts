import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookDispatchConsumer } from './webhook-dispatch.consumer';
import { WebhooksRepository } from './webhooks.repository';

/** The outbox consumer that queues deliveries and the processor that makes them. Imported ONLY by WorkersModule. */
@Module({
  providers: [CryptoService, WebhooksRepository, WebhookDispatchConsumer, WebhookDeliveryProcessor],
})
export class OutboundWebhooksWorkerModule {}
