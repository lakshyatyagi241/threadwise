import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { BroadcastsModule, WARMER_GATE, type WarmerGate } from '../broadcasts';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { ScheduleActionsService } from './schedule-actions.service';
import { ScheduleAudienceService } from './audience/schedule-audience.service';
import { ScheduleCreateService } from './schedule-create.service';
import { ScheduleProducerService } from './schedule-producer.service';
import { ScheduleReadService } from './schedule-read.service';
import { ScheduledController } from './scheduled.controller';
import { SchedulerService } from './scheduler.service';
import { WarmerController } from './warmer.controller';
import { WarmerService } from './warmer/warmer.service';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';

/**
 * Scheduled messages and the number warmer, API side (SCHED): the screens' endpoints, the lifecycle they call and the warmer that
 * paces every bulk sender. The runs themselves are in ScheduledQueueWarmerWorkerModule, imported only by the worker process.
 * Registered in app.module.ts.
 */
@Module({
  imports: [BroadcastsModule, PlansCoreModule, NodeBridgeRuntimeModule],
  controllers: [ScheduledController, WarmerController],
  providers: [
    SchedulerService,
    WarmerService,
    ScheduleAudienceService,
    ScheduleCreateService,
    ScheduleReadService,
    ScheduleActionsService,
    ScheduleProducerService,
  ],
  exports: [
    SchedulerService,
    WarmerService,
    ScheduleProducerService,
    ScheduleCreateService,
    ScheduleReadService,
    ScheduleActionsService,
  ],
})
export class ScheduledQueueWarmerModule implements OnModuleInit {
  constructor(
    @Inject(WARMER_GATE) private readonly gate: WarmerGate,
    private readonly warmer: WarmerService,
  ) {}

  /** The broadcast and campaign dispatchers ask `WARMER_GATE`; this is the warmer that answers (it passes everything until now). */
  onModuleInit(): void {
    (this.gate as { use?: (g: WarmerGate) => void }).use?.(this.warmer);
  }
}
