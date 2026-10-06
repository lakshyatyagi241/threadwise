import { Module } from '@nestjs/common';
import { BroadcastsModule } from '../../../broadcasts';
import { CampaignsModule } from '../../../campaigns';
import { CrmModule } from '../../../crm';
import { ScheduledQueueWarmerModule } from '../../../scheduled-queue-warmer';
import { BearerApiKeyGuard } from '../../auth/bearer-api-key.guard';
import { V1BroadcastsAdapter } from './broadcasts.adapter';
import { V1BroadcastsController } from './broadcasts.controller';
import { V1CampaignsAdapter } from './campaigns.adapter';
import { V1CampaignsController } from './campaigns.controller';
import { ScheduledExtrasRepository } from './scheduled-extras.repository';
import { V1ScheduledAdapter } from './scheduled.adapter';
import { V1ScheduledController } from './scheduled.controller';
import { V1SenderKeys } from './sender-keys.service';

/**
 * Customer REST API v1, bulk sends: broadcasts, campaigns and scheduled messages (TW-API-080 to 095). Each controller is a thin adapter over
 * the staff service of its domain (reached through its barrel), so an API send runs the same plan, wallet, consent and warmer checks as one
 * from the dashboard, and the send itself stays with the worker.
 */
@Module({
  imports: [BroadcastsModule, CampaignsModule, ScheduledQueueWarmerModule, CrmModule],
  controllers: [V1BroadcastsController, V1CampaignsController, V1ScheduledController],
  providers: [
    BearerApiKeyGuard,
    V1SenderKeys,
    V1BroadcastsAdapter,
    V1CampaignsAdapter,
    V1ScheduledAdapter,
    ScheduledExtrasRepository,
  ],
})
export class V1BulkModule {}
