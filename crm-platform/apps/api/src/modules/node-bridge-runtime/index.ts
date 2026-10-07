/**
 * Public surface of the Node bridge domain (NODE). Other modules import from here, never from the files behind it.
 * `NodeBridgeSettingsService.read()` is the one place the saved bridge address and pacing are read.
 */
export { NodeBridgeRuntimeModule } from './node-bridge-runtime.module';
export { NodeBridgeSettingsService } from './node-bridge-settings.service';
export { NodeTokenGuard } from './node-token.guard';
export {
  SafeFetch,
  UnsafeMediaUrlError,
} from '../../infra/providers/node-bridge-runtime/safe-fetch';
export { OutboundRegistry } from './outbound/outbound-registry.service';
export { senderDigits } from './outbound/sender-resolver.service';
export { SenderResolver } from './outbound/sender-resolver.service';
export {
  UnsupportedSendError,
  type EngineTransport,
  type OpenTransport,
  type SendCommand,
  type SendContext,
  type SendOutcome,
  type SenderRef,
} from './outbound/outbound';
export { NodeBridgeRuntimeWorkerModule } from './node-bridge-runtime-worker.module';
export { NodeWorkerStatus } from './runtime/worker-status';
export {
  DeviceControlService,
  WORKER_NO_ANSWER,
  WORKER_NOT_RUNNING,
  type DeviceStatusView,
} from './runtime/device-control.service';
export type { DeviceCommandResult } from './runtime/device-command';
export {
  InboundRouter,
  ReceiptRouter,
  type DeliveryReport,
  type InboundSink,
  type ReceiptSink,
} from './runtime/routers';
export type { Normalized } from '../../infra/providers/node-bridge-runtime/inbound-normalizer';
export type { GroupSnapshot } from '../../infra/providers/node-bridge-runtime/inbound.port';
export type { GroupAction } from '../../infra/providers/node-bridge-runtime/socket.port';
export type { MessageAction } from '../../infra/providers/node-bridge-runtime/outbound.port';
