/**
 * Public surface of realtime. Domains publish through `RealtimeEmitter` (HTTP app and worker alike) and decide who hears an event
 * with `AudienceResolver`; they never touch socket.io.
 */
export { RealtimeEmitterModule } from './realtime-emitter.module';
export { RealtimeEmitter, type EmitReport } from './realtime-emitter.service';
export { AudienceResolver, type AudienceOptions } from './audience/audience.resolver';
export { VisibilityPresence } from './visibility-presence.service';
export { MemberDirectory } from './audience/member-directory.service';
export {
  PERM_CONVERSATION_READ,
  PERM_CONVERSATION_READ_UNASSIGNED,
  conversationVisible,
  viewerReadsUnassigned,
  PERSONAL_OWNER_GONE,
  type ConversationRecord,
  type ConversationViewer,
} from './audience/conversation-visibility';
export {
  PERM_MAIL_SETTINGS_MANAGE,
  adminsCanReadPersonal,
  channelOwnerSql,
  channelRowOwnerSql,
  channelVisibleTo,
} from './audience/channel-owner';
export {
  CONVERSATION_RECORD_LOADER,
  type ConversationRecordLoader,
} from './audience/conversation-record.loader';
export { roomName, roomKeyFor, type RoomRef } from './rooms';
