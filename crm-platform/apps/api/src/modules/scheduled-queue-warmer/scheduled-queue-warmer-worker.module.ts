import { Module, type OnModuleInit } from '@nestjs/common';
import { ContactConsentModule } from '../contact-consent';
import { BroadcastReceiptsService, BroadcastsModule } from '../broadcasts';
import { CampaignReceiptsService, CampaignsModule } from '../campaigns';
import { CrmModule } from '../crm';
import { NodeBridgeRuntimeModule, ReceiptRouter } from '../node-bridge-runtime';
import { WabaReceiptRegistry } from '../whatsapp-cloud-api-waba';
import { ScheduledQueueWarmerModule } from './scheduled-queue-warmer.module';
import { ScheduledDueService } from './scheduled-due.service';
import { ScheduledRunProcessor } from './scheduled-run.processor';
import { ScheduledReceiptsService } from './scheduled-receipts.service';
import { ScheduledRunService } from './scheduled-run.service';

/**
 * The runs of scheduled messages: the due poller and the queue processor. Imported ONLY by WorkersModule (the worker
 * process): an API pod that also polled would multiply the load on the database. Shares the broadcast sender's pacing, daily
 * cap and one-run-per-number lease, so a number is never in a broadcast and a schedule at once.
 */
@Module({
  imports: [
    NodeBridgeRuntimeModule,
    ContactConsentModule,
    BroadcastsModule,
    CampaignsModule,
    CrmModule,
    ScheduledQueueWarmerModule,
  ],
  providers: [
    ScheduledDueService,
    ScheduledRunService,
    ScheduledRunProcessor,
    ScheduledReceiptsService,
  ],
})
export class ScheduledQueueWarmerWorkerModule implements OnModuleInit {
  constructor(
    private readonly router: ReceiptRouter,
    private readonly campaigns: CampaignReceiptsService,
    private readonly broadcasts: BroadcastReceiptsService,
    private readonly scheduled: ScheduledReceiptsService,
    private readonly waba: WabaReceiptRegistry,
  ) {}

  /**
   * Delivery reports from the unofficial engine go to the campaign, broadcast or scheduled recipient that owns the message id. A Cloud
   * API status that the broadcasts did not claim is offered to the scheduled messages next, so a scheduled send reaches `delivered`,
   * `read` or `failed` and the wallet charges or refunds it.
   */
  onModuleInit(): void {
    this.router.register((r) => this.campaigns.handle(r));
    this.router.register((r) => this.broadcasts.handle(r));
    this.router.register((r) => this.scheduled.handle(r));
    this.waba.register((r) => this.scheduled.handleReceipt(r));
  }
}
