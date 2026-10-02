import { Module } from '@nestjs/common';
import { BroadcastsModule } from '../broadcasts';
import { CrmModule } from '../crm';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { ScheduledDueService } from './scheduled-due.service';
import { ScheduledRunProcessor } from './scheduled-run.processor';
import { ScheduledRunService } from './scheduled-run.service';

/**
 * The runs of scheduled messages: the due poller and the queue processor. Imported ONLY by WorkersModule (the worker
 * process): an API pod that also polled would multiply the load on the database. Shares the broadcast sender's pacing, daily
 * cap and one-run-per-number lease, so a number is never in a broadcast and a schedule at once.
 */
@Module({
  imports: [NodeBridgeRuntimeModule, BroadcastsModule, CrmModule],
  providers: [ScheduledDueService, ScheduledRunService, ScheduledRunProcessor],
})
export class ScheduledQueueWarmerWorkerModule {}
