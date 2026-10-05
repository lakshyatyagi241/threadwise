import { Injectable } from '@nestjs/common';
import {
  PERM_CONVERSATION_READ,
  conversationVisible,
  type ConversationRecord,
} from './conversation-visibility';
import { MemberDirectory } from './member-directory.service';

export interface AudienceOptions {
  /** The permission that gates the record. Defaults to reading conversations. */
  permission?: string;
  /**
   * People who must hear about the change although they may no longer see the record: the previous assignee after a
   * reassignment, so their list drops the row. They receive a signal (ids, no content).
   */
  alsoUserIds?: Iterable<number>;
  /** People to leave out, typically the one who made the change and already knows. */
  excludeUserIds?: Iterable<number>;
}

/**
 * Decides who a realtime event about a record goes to, from permissions and the record's scope, at the moment of the emit.
 * Because it is recomputed per event, a role changed while sockets are open takes effect on the next event.
 *
 * It answers with staff user ids; the emitter turns them into `user:` rooms (`RealtimeEmitter.emitToUsers`). A conversation is
 * never sent to a person who may not read it, which is the hole Reference's workspace-wide inbox channel had.
 */
@Injectable()
export class AudienceResolver {
  constructor(private readonly directory: MemberDirectory) {}

  /** The staff users who may see this conversation, plus `alsoUserIds`, minus `excludeUserIds`. */
  async forConversation(
    orgId: number,
    record: ConversationRecord,
    options: AudienceOptions = {},
  ): Promise<number[]> {
    const viewers = await this.directory.viewers(
      orgId,
      options.permission ?? PERM_CONVERSATION_READ,
    );
    const audience = new Set<number>();
    for (const viewer of viewers)
      if (conversationVisible(viewer, record)) audience.add(viewer.userId);
    for (const id of options.alsoUserIds ?? []) audience.add(id);
    for (const id of options.excludeUserIds ?? []) audience.delete(id);
    return [...audience];
  }
}
