import { Module } from '@nestjs/common';
import { GrowthHandoverConsumer } from './growth-handover.consumer';
import { GrowthPilotModule } from './growth-pilot.module';
import { GrowthSweeper } from './growth-sweeper';

/**
 * What only the worker runs: the schedule and the handover consumer. Imported ONLY by WorkersModule: an API pod that also ran them
 * would multiply the load.
 */
@Module({
  imports: [GrowthPilotModule],
  providers: [GrowthSweeper, GrowthHandoverConsumer],
})
export class GrowthPilotWorkerModule {}
