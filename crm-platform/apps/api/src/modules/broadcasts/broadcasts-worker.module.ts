import { Module } from '@nestjs/common';
import { BroadcastDispatchProcessor } from './broadcast-dispatch.processor';
import { BroadcastDueService } from './broadcast-due.service';
import { BroadcastResumeService } from './broadcast-resume.service';
import { BroadcastRetrySweeper } from './broadcast-retry-sweeper.service';
import { BroadcastsModule } from './broadcasts.module';

/**
 * The broadcast sender: the due-broadcast queueing and the dispatch processor. Imported ONLY by WorkersModule (the worker
 * process): the HTTP app creates broadcasts but must never queue or send them.
 */
@Module({
  imports: [BroadcastsModule],
  providers: [
    BroadcastDueService,
    BroadcastDispatchProcessor,
    BroadcastRetrySweeper,
    BroadcastResumeService,
  ],
})
export class BroadcastsWorkerModule {}
