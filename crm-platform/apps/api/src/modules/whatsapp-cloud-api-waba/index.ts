/** Public surface of the WhatsApp number domain. Other domains import only from here. */
export { WabaModule } from './waba.module';
export { WabaWorkerModule } from './waba-worker.module';
export { WabaConnectService, type ResolvedWabaConnection } from './waba-connect.service';
export { localStatusFor } from './template-event-rules';
export { WABA_INBOUND_SINK, type InboundContext, type WabaInboundSink } from './waba-inbound-sink';
