import { Module } from '@nestjs/common';
import { SendWindowModule } from '../compliance-center';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignSweeper } from './campaign-sweeper.service';
import { CampaignProcessor } from './campaign.processor';
import { CampaignsModule } from './campaigns.module';
import { FixtureReceiptConsumer } from './fixture/fixture-receipts';
import { WizardFollowUpService } from './wizard/wizard-follow-up.service';
import { WizardRetryService } from './wizard/wizard-retry.service';
import { WizardSeriesService } from './wizard/wizard-series.service';
import { WizardWorker } from './wizard/wizard-worker.service';

/**
 * The campaign sender: the run processor, the sweeper that starts due campaigns, and the broadcast wizard's clock (the planner of
 * recurring runs and the frequency-cap retries). Imported ONLY by WorkersModule (the worker
 * process): the HTTP app creates and controls campaigns but must never send them.
 *
 * `SendWindowModule` is imported here, not only through `CampaignsModule`: a module's imports are not re-exported, so the senders below
 * would otherwise get no quiet-hours service and send marketing inside the hours.
 */
@Module({
  imports: [CampaignsModule, SendWindowModule],
  providers: [
    CampaignDispatchService,
    CampaignProcessor,
    CampaignSweeper,
    FixtureReceiptConsumer,
    WizardSeriesService,
    WizardRetryService,
    WizardFollowUpService,
    WizardWorker,
  ],
})
export class CampaignsWorkerModule {}
