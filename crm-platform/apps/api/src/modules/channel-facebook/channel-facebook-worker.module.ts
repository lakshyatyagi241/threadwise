import { Module } from '@nestjs/common';
import { ChannelFacebookModule } from './channel-facebook.module';
import { FbBackfillProcessor } from './fb-backfill.processor';
import { PageHealthSweepService } from './page-health-sweep.service';

/** The Facebook queue processors and the hourly health sweep. Imported ONLY by WorkersModule: the HTTP app queues jobs but must never run them. */
@Module({
  imports: [ChannelFacebookModule],
  providers: [FbBackfillProcessor, PageHealthSweepService],
})
export class ChannelFacebookWorkerModule {}
