/**
 * Public surface of the Node bridge domain (NODE). Other modules import from here, never from the files behind it.
 * `NodeBridgeSettingsService.read()` is the one place the saved bridge address and pacing are read.
 */
export { NodeBridgeRuntimeModule } from './node-bridge-runtime.module';
export { NodeCatalogBridgeModule } from './node-catalog-bridge.module';
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
export type {
  GroupEvent,
  GroupParticipantSnapshot,
  GroupPatch,
  GroupSnapshot,
  InboundMessage,
} from '../../infra/providers/node-bridge-runtime/inbound.port';
export type {
  HistoryBatch,
  HistoryChat,
  HistoryContact,
} from '../../infra/providers/node-bridge-runtime/history.port';
export type { HistoryImportLimits } from '../../infra/providers/node-bridge-runtime/baileys.socket-factory';
export { HISTORY_IMPORT_LIMITS } from '../../infra/providers/node-bridge-runtime/baileys.socket-factory';
export {
  bareGroupId,
  classifyGroupError,
  COOLDOWN_REASONS,
  inviteCodeOf,
  jidUser,
  mentionToken,
  participantOutcome,
  toGroupJid,
  type GroupFailureReason,
  type ParticipantChange,
  type ParticipantOutcome,
} from '../../infra/providers/node-bridge-runtime/group-mapping';
export {
  GroupOpLimiter,
  loadGroupLimits,
  opKindOf,
  type GroupLimits,
  type GroupLimitsView,
  type GroupRefusal,
} from './runtime/group-limiter';
export type {
  GroupAction,
  GroupInviteInfo,
  GroupJoinRequestSnapshot,
  GroupParticipantStatus,
  GroupResult,
} from '../../infra/providers/node-bridge-runtime/socket.port';
export type { MessageAction } from '../../infra/providers/node-bridge-runtime/outbound.port';
