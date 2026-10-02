import { Injectable } from '@nestjs/common';
import type { MessageResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { toMessageResponse } from './message.mapper';
import type { MessageRow } from './messages.repository';

/**
 * A stored message as the caller sees it: the wire shape, with each file as a short-lived authenticated link minted for THIS person
 * (the media route refuses a link made for someone else). Call it only after the caller has been allowed to see the conversation.
 */
@Injectable()
export class MessageViewService {
  constructor(private readonly media: ChatMediaStore) {}

  respond(row: MessageRow): MessageResponse {
    const ctx = RequestContextStore.require();
    return toMessageResponse(row, (r) =>
      ctx.userId === null || r.mediaKey === null
        ? null
        : this.media.accessUrl(
            r.mediaKey,
            { orgId: ctx.orgId, userId: ctx.userId },
            { name: r.mediaName, mime: r.mediaMime },
          ),
    );
  }

  respondMany(rows: MessageRow[]): MessageResponse[] {
    return rows.map((r) => this.respond(r));
  }
}
