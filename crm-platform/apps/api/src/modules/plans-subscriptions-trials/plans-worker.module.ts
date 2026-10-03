import { Module } from '@nestjs/common';
import { PlanRetentionSweepService } from './plan-retention-sweep.service';
import { PlanRetentionService } from './plan-retention.service';
import { PlanStore } from './plan-store';

/** Background work of the plans domain (the retention sweep). Imported by WorkersModule only, never by the HTTP app. */
@Module({
  providers: [PlanStore, PlanRetentionService, PlanRetentionSweepService],
  exports: [PlanRetentionService],
})
export class PlansWorkerModule {}
