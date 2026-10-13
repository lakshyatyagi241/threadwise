/**
 * Public surface of the team inbox's conversation domain. Other modules (the assignment domain, later routing and SLA) import from
 * here, never from the files behind it.
 */
export { TeamInboxConversationsModule } from './team-inbox-conversations.module';
export {
  InboxAccess,
  PERM as INBOX_PERMISSION,
  conversationNotFound,
} from './inbox-access.service';
export { InboxConversationsService } from './inbox-conversations.service';
export { InboxRealtimePublisher } from './inbox-realtime.publisher';
export { InboxSystemNotes } from './inbox-system-notes.service';
export {
  ConversationEventsRepository,
  type AppendEventInput,
} from './conversation-events.repository';
export { ConversationsRepository, type LockedConversation } from './conversations.repository';
export { visibleToSql } from './visibility-sql';
