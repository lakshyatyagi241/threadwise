import { slaStatus } from '../../common/sla-time';
import type {
  ConversationStatus,
  ConversationSummary,
  InboxContactSummary,
  PastConversation,
} from '@crm/contracts';
import type { InboxConversationRow } from './conversations.repository';

const toChannelRef = (row: InboxConversationRow) => ({
  id: row.channelUuid,
  kind: row.channelKind,
  name: row.channelName,
});

/** ISO text with milliseconds: what the wire carries (the database's microsecond text is only for cursors). */
export const iso = (t: string | null): string | null =>
  t === null ? null : new Date(t).toISOString();
const isoOrNow = (t: string): string => new Date(t).toISOString();

/**
 * The list row. The name the list shows is the contact's, else the peer's, else the title the thread was created with (the number):
 * the thread's own `title` can be older than a rename of the contact.
 */
export function toConversationSummary(row: InboxConversationRow): ConversationSummary {
  const contactName = row.contactName?.trim() ? row.contactName : null;
  const peerName = row.peerName?.trim() ? row.peerName : null;
  return {
    id: row.uuid,
    channel: toChannelRef(row),
    peerKey: row.peerKey,
    peerName: row.peerName,
    title: contactName ?? peerName ?? row.title,
    preview: row.preview,
    status: row.status as ConversationStatus,
    priority: row.priority as ConversationSummary['priority'],
    archived: row.archived,
    pinned: row.pinnedAt !== null,
    muted: row.mutedAt !== null,
    unreadCount: row.unreadCount,
    needsContact: row.needsContact,
    ...(row.imported ? { imported: true } : {}),
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    assignment: {
      user: row.assigneeUserUuid ? { id: row.assigneeUserUuid, name: row.assigneeUserName } : null,
      team: row.assigneeTeamUuid
        ? {
            id: row.assigneeTeamUuid,
            name: row.assigneeTeamName ?? '',
            color: row.assigneeTeamColor,
          }
        : null,
      aiAgent: row.assigneeAgentUuid
        ? { id: row.assigneeAgentUuid, name: row.assigneeAgentName ?? '' }
        : null,
    },
    snoozedUntil: iso(row.snoozedUntil),
    labels: row.labels,
    slaStatus: slaStatus(
      {
        status: row.status,
        waitingSince: row.waitingSince,
        firstResponseDue: row.slaFirstResponseDue,
        resolutionDue: row.slaResolutionDue,
        breached: row.slaBreached,
      },
      new Date(),
    ),
    lastMessageAt: iso(row.lastMessageAt),
    lastInboundAt: iso(row.lastInboundAt),
    lastOutboundAt: iso(row.lastOutboundAt),
    lastSeq: row.msgSeq,
    windowExpiresAt: iso(row.windowExpiresAt),
    createdAt: isoOrNow(row.createdAt),
    updatedAt: isoOrNow(row.updatedAt),
    rowVersion: row.rowVersion,
  };
}

export function toPastConversation(row: InboxConversationRow): PastConversation {
  const s = toConversationSummary(row);
  return {
    id: s.id,
    channel: s.channel,
    title: s.title,
    preview: s.preview,
    status: s.status,
    lastMessageAt: s.lastMessageAt,
  };
}

export interface ContactSource {
  uuid: string;
  displayId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  lifecycleStage: string | null;
  status: string | null;
  source: string | null;
  isUnsubscribed: boolean;
  whatsappSubscriptionStatus: string | null;
  leadScore: number | null;
  leadScoreSource: 'manual' | 'ai' | null;
  leadScoreReasons: string[] | null;
  leadScoredAt: Date | null;
  leadScoreModel: string | null;
  createdAt: Date;
}

export const toContactSummary = (
  c: ContactSource,
  ownerName: string | null,
  contactTags: InboxContactSummary['contactTags'] = [],
): InboxContactSummary => ({
  id: c.uuid,
  displayId: c.displayId,
  name: c.name,
  email: c.email,
  phone: c.phone,
  lifecycleStage: c.lifecycleStage,
  status: c.status,
  ownerName,
  source: c.source,
  isUnsubscribed: c.isUnsubscribed,
  whatsappSubscriptionStatus: c.whatsappSubscriptionStatus,
  leadScore: c.leadScore,
  leadScoreSource: c.leadScoreSource,
  leadScoreReasons: c.leadScoreReasons,
  leadScoredAt: c.leadScoredAt ? c.leadScoredAt.toISOString() : null,
  leadScoreModel: c.leadScoreModel,
  createdAt: c.createdAt.toISOString(),
  contactTags,
});
