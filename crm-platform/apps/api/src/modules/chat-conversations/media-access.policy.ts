import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChatMediaAccessPolicy } from '../../infra/providers/chat-conversations/media';
import { PERM_CONVERSATION_READ, MemberDirectory, conversationVisible } from '../../realtime';
import { MessagesRepository } from './messages.repository';

/**
 * Who may read a stored chat file, beyond "it is in your workspace" (the media route's own check): the person must still be allowed to
 * see the conversation the file belongs to, by the same rule as the list, the thread and the socket (`conversationVisible`). A link
 * made for an agent therefore stops working when the conversation is reassigned away from them or their role loses the right, even
 * within the link's few minutes.
 *
 * A key that is on no message yet (an upload waiting in the composer) is not a conversation's file: the link was minted for this person
 * by code that had already authorised them, and the key is unguessable and belongs to this workspace.
 *
 * Bound by `app.module` to `MEDIA_ACCESS_POLICY` (`ChatMediaModule.register({ accessPolicy })`). Stateless on purpose: the media module
 * instantiates it in its own scope, which has the database and the realtime directory (both global) and nothing else.
 */
@Injectable()
export class MessageMediaAccessPolicy implements ChatMediaAccessPolicy {
  private readonly messages = new MessagesRepository();

  constructor(
    private readonly db: DatabaseService,
    private readonly directory: MemberDirectory,
  ) {}

  async canRead(actor: { orgId: number; userId: number }, key: string): Promise<boolean> {
    const owner = await this.db.txAs({ orgId: actor.orgId, userId: actor.userId }, (tx) =>
      this.messages.conversationOfMedia(tx, actor.orgId, key),
    );
    if (!owner) return true;
    const viewer = await this.directory.viewer(actor.orgId, actor.userId, PERM_CONVERSATION_READ);
    return conversationVisible(viewer, owner);
  }
}
