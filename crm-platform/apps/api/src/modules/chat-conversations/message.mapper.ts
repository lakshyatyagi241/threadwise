import type { MessageResponse } from '@crm/contracts';
import type { MessageRow } from './messages.repository';

/** Mints the short-lived url of a stored file for one reader; null leaves the url out (the realtime payload has no single reader). */
export type MediaLinker = (row: MessageRow) => string | null;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The only place a message row becomes its wire shape (internal ids never leave: every reference is a uuid; the storage key never
 * leaves: the file is a link minted per reader).
 */
export function toMessageResponse(row: MessageRow, link: MediaLinker): MessageResponse {
  const url = row.mediaKey ? link(row) : null;
  const strings = (v: unknown): Record<string, string> =>
    v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === 'string',
          ),
        )
      : {};

  return {
    id: row.uuid,
    conversationId: row.conversationUuid,
    seq: row.seq,
    direction: row.direction,
    kind: row.kind,
    sender: { kind: row.senderKind, userId: row.senderUserUuid, name: row.senderName },
    body: row.body,
    media: row.mediaKey
      ? {
          url: url ?? '',
          mime: row.mediaMime ?? 'application/octet-stream',
          sizeBytes: row.mediaSize,
          name: row.mediaName,
        }
      : null,
    location:
      row.kind === 'location' && row.latitude !== null && row.longitude !== null
        ? {
            latitude: row.latitude,
            longitude: row.longitude,
            name: str(row.meta.locationName),
            address: str(row.meta.locationAddress),
          }
        : null,
    template:
      row.kind === 'template'
        ? {
            templateId: row.templateUuid,
            name: str(row.meta.templateName) ?? '',
            language: str(row.meta.templateLanguage),
            variables: strings(row.meta.templateVariables),
          }
        : null,
    status: row.status,
    failure: row.status === 'failed' ? { code: row.failureCode, reason: row.failureReason } : null,
    clientMessageId: row.clientMessageId,
    replyToMessageId: row.replyToMessageUuid,
    reaction: row.reaction,
    isTranslated: row.isTranslated,
    translatedBody: row.translatedBody,
    detectedLanguage: row.detectedLanguage,
    starred: row.starred,
    pinned: row.pinned,
    editedAt: iso(row.editedAt),
    deletedAt: iso(row.deletedAt),
    providerAt: iso(row.providerTs),
    sentAt: iso(row.sentAt),
    deliveredAt: iso(row.deliveredAt),
    readAt: iso(row.readAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A message as the realtime `inbox.message.new` event carries it. The event goes to every person with the thread open, and a media
 * link is minted for one reader, so the event leaves the url empty (`media.url === ''`): a client that sees a media message
 * fetches the page after `seq - 1` over REST, which returns a link for it.
 */
export function toRealtimeMessage(row: MessageRow): MessageResponse {
  return toMessageResponse(row, () => null);
}
