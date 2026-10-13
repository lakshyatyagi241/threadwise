/** Public surface of the chat-conversations domain. Other modules import from here, never from the files behind it. */
export { ChatConversationsModule } from './chat-conversations.module';
export { ChannelsFacade, type ChannelSummary } from './channels.facade';
export {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type EnqueueOutboundInput,
  type EnqueueOutboundResult,
  type OutboundContent,
  type OutboundMediaRef,
  type RecordOutboundInput,
  type RecordOutboundTemplate,
  type ThreadRef,
} from './conversations.facade';
export {
  ChannelDispatcher,
  type DispatchRequest,
  type DispatchResult,
  type QueueCheckOptions,
} from './channel-dispatcher.service';
export { ChannelAdapterRegistry } from './channel-adapter.registry';
export { ChannelRegistryService } from './channel-registry.service';
export { ChannelIngestPublisher } from './channel-ingest.publisher';
export { InboundIngestService, type IngestOutcome } from './inbound-ingest.service';
export { ExternalChannelIngest, type ExternalAccount } from './external-channel-ingest.service';
export { ChatConversationsWorkerModule } from './chat-conversations-worker.module';
export { MessageMediaAccessPolicy } from './media-access.policy';
export { normalizePeerKey, identityOfPeer, isPhoneChannel } from './peer-key';
export {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from './inbound-hooks';
export { EmailMessageAccess, type EmailMessageRef } from './email-message-access.service';
export { isAutomatedEmail } from './inbound-hooks';
export {
  EmailDeliveryService,
  EMAIL_BOUNCED_EVENT,
  type RecordBounceInput,
  type RecordBounceOutcome,
} from './email-delivery.service';
export { MESSAGE_LOG_FACADE, type MessageLogFacade } from './message-log.facade';
export { PersonalGroupThreadReader } from './personal-group-thread.reader';
export { CloudGroupThreadReader } from './cloud-group-thread.reader';
export { DeviceGroupThreadTitleService } from './device-group-thread-title.service';
