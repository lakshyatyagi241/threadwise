import type {
  TchatChannelResponse,
  TchatInvitationResponse,
  TchatMember,
  TchatMessageResponse,
  TchatReaction,
} from '@crm/contracts';
import { quoteSnippet } from './chat-rules';
import type {
  ChannelListRow,
  ChannelRow,
  InvitationRow,
  MessageRow,
  PersonRow,
} from './team-chat.repository';

/**
 * Row -> API shape. The one place an internal bigint id becomes a uuid: nothing outside these functions may put an id in a
 * response (CONTRIBUTING rule 4).
 */

export function toChannelResponse(
  row: ChannelRow | ChannelListRow,
  extra?: { unread?: number },
): TchatChannelResponse {
  const list = row as Partial<ChannelListRow>;
  return {
    id: row.uuid,
    name: row.name,
    slug: row.slug,
    type: row.type,
    description: row.description,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    unread: extra?.unread ?? list.unread ?? 0,
    peer: list.peerUuid ? { id: list.peerUuid, name: list.peerName ?? 'Unknown' } : null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMemberResponse(row: PersonRow): TchatMember {
  return { id: row.uuid, name: row.name, email: row.email };
}

/** The URL a client fetches an attachment from: the authenticated route, never a storage path. */
export const attachmentUrl = (messageUuid: string) =>
  `/api/v2/team-chat/messages/${messageUuid}/attachment`;

export function toMessageResponse(
  row: MessageRow,
  ctx: {
    me: number;
    /** user internal id -> uuid, for the mention ids stored on the row. */
    userUuids: Map<number, string>;
    reactions: TchatReaction[];
  },
): TchatMessageResponse {
  const mime = row.attachmentMime;
  return {
    id: row.uuid,
    channelId: row.channelUuid,
    authorId: row.authorUuid,
    authorName: row.authorName ?? 'Unknown',
    body: row.body,
    mentions: row.mentionIds.flatMap((id) => {
      const uuid = ctx.userUuids.get(id);
      return uuid ? [uuid] : [];
    }),
    replyTo:
      row.replyToId && row.replyUuid
        ? {
            id: row.replyUuid,
            authorName: row.replyAuthorName ?? 'Unknown',
            snippet: quoteSnippet(row.replyBody),
          }
        : null,
    attachment: row.hasAttachment
      ? {
          name: row.attachmentName ?? 'file',
          mime,
          url: attachmentUrl(row.uuid),
          isImage: Boolean(mime && mime.startsWith('image/')),
        }
      : null,
    reactions: ctx.reactions,
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    editedAt: row.editedAt?.toISOString() ?? null,
    isMine: row.userId !== null && row.userId === ctx.me,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvitationResponse(row: InvitationRow): TchatInvitationResponse {
  return {
    id: row.uuid,
    inviteeEmail: row.inviteeEmail,
    inviteeName: row.inviteeName,
    requesterName: row.requesterName ?? 'Unknown',
    requesterEmail: row.requesterEmail,
    channel: row.channelUuid ? { id: row.channelUuid, name: row.channelName ?? '' } : null,
    status: row.status,
    note: row.note,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    needsAccount: !row.inviteeActive,
    createdAt: row.createdAt.toISOString(),
  };
}
