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
export type { HistoryItem } from './waba-coexistence-rules';
export {
  WABA_INBOUND_SINK,
  WABA_INBOUND_SINK_OVERRIDE,
  type BusinessAppEcho,
  type InboundContext,
  type WabaInboundSink,
} from './waba-inbound-sink';
export { WABA_CALLS_SINK, WABA_CALLS_SINK_OVERRIDE, type WabaCallsSink } from './waba-calls-sink';
export { WabaReceiptRegistry, type WabaReceiptSink } from './waba-receipt-registry';
export { WabaWebhookService } from './waba-webhook.service';
export { WabaDiagnosticsService } from './waba-diagnostics.service';
export { WabaConnectionsRepository } from './waba-connections.repository';
export { WEBHOOK_PATH } from './waba-rules';
