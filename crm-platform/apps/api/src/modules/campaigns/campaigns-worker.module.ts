import { Module } from '@nestjs/common';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignSweeper } from './campaign-sweeper.service';
import { CampaignProcessor } from './campaign.processor';
import { CampaignsModule } from './campaigns.module';

/**
 * The campaign sender: the run processor and the sweeper that starts due campaigns. Imported ONLY by WorkersModule (the worker
 * process): the HTTP app creates and controls campaigns but must never send them.
 */
@Module({
  imports: [CampaignsModule],
  providers: [CampaignDispatchService, CampaignProcessor, CampaignSweeper],
})
export class CampaignsWorkerModule {}
