import { Global, Module } from '@nestjs/common';
import { RealtimeEmitterModule } from '../../realtime';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { WABA_CALLS_SINK_OVERRIDE } from '../whatsapp-cloud-api-waba';
import { CallRealtimeConsumer } from './call-realtime.consumer';
import {
  CallingConnectConsumer,
  CallingReadinessProcessor,
  CallingReadinessScheduler,
} from './calling-readiness.jobs';
import { CallingVoiceModule } from './calling-voice.module';
import { CallRecordingRetentionService } from './call-recording-retention.service';
import { CallingWabaSink } from './calling-waba.sink';

/**
 * Hands the WABA webhook's `calls` field to the calling domain. The WABA module binds `WABA_CALLS_SINK` to whatever provides
 * `WABA_CALLS_SINK_OVERRIDE` (a logging default when nothing does); this module provides it and is global so the WABA module sees it
 * without importing calling: the dependency points from calling to the WhatsApp domain, never back.
 *
 * Imported by WorkersModule only: the sink runs in the webhook worker (`WabaIngestProcessor`).
 */
@Global()
@Module({
  imports: [CallingVoiceModule, RealtimeEmitterModule, PlansCoreModule],
  providers: [
    { provide: WABA_CALLS_SINK_OVERRIDE, useExisting: CallingWabaSink },
    CallRealtimeConsumer,
    CallRecordingRetentionService,
    CallingReadinessProcessor,
    CallingConnectConsumer,
    CallingReadinessScheduler,
  ],
  exports: [WABA_CALLS_SINK_OVERRIDE],
})
export class CallingVoiceWorkerModule {}
