import { Global, Module } from '@nestjs/common';
import { RealtimeEmitterModule } from '../../realtime';
import { WABA_CALLS_SINK_OVERRIDE } from '../whatsapp-cloud-api-waba';
import { CallRealtimeConsumer } from './call-realtime.consumer';
import { CallingVoiceModule } from './calling-voice.module';
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
  imports: [CallingVoiceModule, RealtimeEmitterModule],
  providers: [
    { provide: WABA_CALLS_SINK_OVERRIDE, useExisting: CallingWabaSink },
    CallRealtimeConsumer,
  ],
  exports: [WABA_CALLS_SINK_OVERRIDE],
})
export class CallingVoiceWorkerModule {}
