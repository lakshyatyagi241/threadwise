import { Module } from '@nestjs/common';
import { MarketplaceModule } from './marketplace.module';
import { InboundProcessor, InboundSweepService } from './inbound.worker';
import { PullProcessor, PullSweepService } from './pull.worker';
import { SubscriptionSweepService } from './subscription-sweep.worker';

/** The pull connectors' schedule and job, the delivery-row retention sweep, and the paid-app subscription sweep. Imported ONLY by WorkersModule: the HTTP app must never run them. */
@Module({
  imports: [MarketplaceModule],
  providers: [
    PullSweepService,
    PullProcessor,
    InboundSweepService,
    InboundProcessor,
    SubscriptionSweepService,
  ],
})
export class MarketplaceWorkerModule {}
