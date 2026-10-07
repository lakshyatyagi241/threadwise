import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WebhooksController } from './webhooks.controller';
import { WebhooksRepository } from './webhooks.repository';
import { WebhooksService } from './webhooks.service';

/** A workspace's own webhooks: the settings screen's endpoints. Delivery runs in OutboundWebhooksWorkerModule. Registered in app.module.ts. */
@Module({
  imports: [PlansCoreModule],
  controllers: [WebhooksController],
  providers: [CryptoService, WebhooksRepository, WebhooksService],
})
export class OutboundWebhooksModule {}
