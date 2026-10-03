/** Public surface of the WhatsApp number domain. Other domains import only from here. */
export { WabaModule } from './waba.module';
export { WabaWorkerModule } from './waba-worker.module';
export {
  WabaConnectService,
  type ProviderMoveRequirement,
  type ProviderMoveResult,
  type ProviderMoveTarget,
  type ResolvedWabaConnection,
} from './waba-connect.service';
export { localStatusFor } from './template-event-rules';
export {
  WABA_INBOUND_SINK,
  WABA_INBOUND_SINK_OVERRIDE,
  type InboundContext,
  type WabaInboundSink,
} from './waba-inbound-sink';
export { WEBHOOK_PATH } from './waba-rules';
