import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { WabaReceiptRegistry } from '../../whatsapp-cloud-api-waba';
import { CampaignReceiptsService } from '../campaign-receipts.service';
import { WizardRetryService } from './wizard-retry.service';
import { WizardSeriesService } from './wizard-series.service';
import { WizardTestSendService } from './wizard-test-send.service';

/**
 * The wizard's clock, in the worker only (CampaignsWorkerModule): every few seconds it plans the runs of recurring broadcasts that
 * are due and works the frequency-cap retries. Each pass is guarded against overlapping itself, and what it does is idempotent
 * (see the two services), so two workers or a restart in the middle change nothing.
 *
 * It also tells the Cloud API receipt path who else owns a message: a delivery report about a campaign recipient or a wizard test
 * message must reach its row (and the wallet), not only the broadcasts.
 */
@Injectable()
export class WizardWorker implements OnModuleInit {
  private readonly logger = new Logger(WizardWorker.name);
  private planning = false;
  private retrying = false;

  constructor(
    private readonly series: WizardSeriesService,
    private readonly retries: WizardRetryService,
    private readonly receipts: WabaReceiptRegistry,
    private readonly campaignReceipts: CampaignReceiptsService,
    private readonly tests: WizardTestSendService,
  ) {}

  onModuleInit(): void {
    this.receipts.register((r) => this.campaignReceipts.handle(r));
    this.receipts.register((r) => this.tests.handleReceipt(r));
  }

  @Interval(5_000)
  async planTick(): Promise<void> {
    if (this.planning) return;
    this.planning = true;
    try {
      const created = await this.series.tick();
      if (created > 0) this.logger.log({ created }, '[CAMP] recurring runs started');
    } catch (err) {
      this.logger.error({ err }, '[CAMP] planning recurring broadcasts failed');
    } finally {
      this.planning = false;
    }
  }

  @Interval(5_000)
  async retryTick(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    try {
      const done = await this.retries.tick();
      if (done.armed + done.sent + done.settled + done.reaped > 0) {
        this.logger.log(done, '[CAMP] frequency-cap retries worked');
      }
    } catch (err) {
      this.logger.error({ err }, '[CAMP] frequency-cap retries failed');
    } finally {
      this.retrying = false;
    }
  }
}
