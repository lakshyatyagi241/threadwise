import { Module } from '@nestjs/common';
import { MarketplaceModule } from './marketplace.module';
import { PullProcessor, PullSweepService } from './pull.worker';

/** The pull connectors' schedule and job, and the delivery-row retention sweep. Imported ONLY by WorkersModule: the HTTP app must never run them. */
@Module({
  imports: [MarketplaceModule],
  providers: [PullSweepService, PullProcessor],
})
export class MarketplaceWorkerModule {}
