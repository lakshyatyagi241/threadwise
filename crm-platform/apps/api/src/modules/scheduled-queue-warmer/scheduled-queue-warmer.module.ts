import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { BroadcastsModule, WARMER_GATE, type WarmerGate } from '../broadcasts';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { ScheduleActionsService } from './schedule-actions.service';
import { ScheduleAudienceService } from './audience/schedule-audience.service';
import { ScheduleContentService } from './schedule-content.service';
import { ScheduleCreateService } from './schedule-create.service';
import { ScheduleEditService } from './schedule-edit.service';
import { ScheduleEngagementService } from './schedule-engagement.service';
import { ScheduleMediaService } from './schedule-media.service';
import { ScheduleMessageBuilder } from './schedule-message-builder.service';
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
  imports: [
    BroadcastsModule,
    ContactConsentModule,
    CrmModule,
    PlansCoreModule,
    PlatformSettingsModule,
    NodeBridgeRuntimeModule,
  ],
  controllers: [ScheduledController, WarmerController],
  providers: [
    SchedulerService,
    WarmerService,
    ScheduleAudienceService,
    ScheduleContentService,
    ScheduleMessageBuilder,
    ScheduleMediaService,
    ScheduleCreateService,
    ScheduleEditService,
    ScheduleEngagementService,
    ScheduleReadService,
    ScheduleActionsService,
    ScheduleProducerService,
  ],
  exports: [
    SchedulerService,
    WarmerService,
    ScheduleProducerService,
    ScheduleCreateService,
    ScheduleEditService,
    ScheduleMessageBuilder,
    ScheduleMediaService,
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
