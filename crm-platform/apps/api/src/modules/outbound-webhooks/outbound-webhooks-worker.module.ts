import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { guardedRequest } from '../../infra/net/guarded-http';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhookDispatchConsumer } from './webhook-dispatch.consumer';
import { WEBHOOK_TRANSPORT } from './send';
import { WebhooksRepository } from './webhooks.repository';

/** The outbox consumer that queues deliveries and the processor that makes them. Imported ONLY by WorkersModule. */
@Module({
  providers: [
    CryptoService,
    WebhooksRepository,
    WebhookDispatchConsumer,
    WebhookDeliveryProcessor,
    { provide: WEBHOOK_TRANSPORT, useValue: guardedRequest },
  ],
})
export class OutboundWebhooksWorkerModule {}
