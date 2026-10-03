import { Module } from '@nestjs/common';
import { ChannelInstagramModule } from './channel-instagram.module';
import { IgPullProcessor } from './ig-pull.processor';
import { PullSweepService } from './pull-sweep.service';

/** The Instagram pull job and its 20 second sweep. Imported ONLY by WorkersModule: the HTTP app must never run them. */
@Module({
  imports: [ChannelInstagramModule],
  providers: [IgPullProcessor, PullSweepService],
})
export class ChannelInstagramWorkerModule {}
