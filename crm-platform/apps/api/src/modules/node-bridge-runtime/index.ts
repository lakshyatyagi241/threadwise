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
export { DeviceControlService, type DeviceStatusView } from './runtime/device-control.service';
export type { DeviceCommandResult } from './runtime/device-command';
