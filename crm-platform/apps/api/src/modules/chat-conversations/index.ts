/** Public surface of the chat-conversations domain. Other modules import from here, never from the files behind it. */
export { ChatConversationsModule } from './chat-conversations.module';
export { ChannelsFacade, type ChannelSummary } from './channels.facade';
export {
  CONVERSATIONS_FACADE,
  type ConversationsFacade,
  type RecordOutboundInput,
  type ThreadRef,
} from './conversations.facade';
export {
  ChannelDispatcher,
  type DispatchRequest,
  type DispatchResult,
  type QueueCheckOptions,
} from './channel-dispatcher.service';
export { ChannelRegistryService } from './channel-registry.service';
export { ChannelIngestPublisher } from './channel-ingest.publisher';
