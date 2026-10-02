import type { OutboundContent } from './conversations.facade';
import { kindOfFileMime } from './message-rules';
import type { MessageRow } from './messages.repository';

/** What a stored message becomes for the dispatcher (which validates it against `outboundEnvelopeSchema`). */
export function envelopeOf(
  row: Pick<
    MessageRow,
    'kind' | 'body' | 'mediaKey' | 'mediaMime' | 'mediaName' | 'meta' | 'clientMessageId' | 'uuid'
  >,
  peerKey: string,
  replyToProviderMessageId: string | null,
  attempt: number,
): unknown {
  const common = {
    to: peerKey,
    // Stable across every retry of this one message: it is the idempotency key of the send. Messages written without a client id
    // (a bot's) fall back to their own uuid.
    clientReference: row.clientMessageId ?? row.uuid,
    attempt,
    ...(replyToProviderMessageId ? { replyToProviderMessageId } : {}),
  };
  switch (row.kind) {
    case 'text':
      return { ...common, kind: 'text', body: row.body ?? '' };
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      return {
        ...common,
        kind: 'media',
        media: {
          key: row.mediaKey ?? '',
          mediaKind: row.kind,
          mime: row.mediaMime ?? 'application/octet-stream',
          ...(row.mediaName ? { name: row.mediaName } : {}),
          ...(row.body ? { caption: row.body } : {}),
        },
      };
    case 'template': {
      const meta = row.meta as {
        templateName?: string;
        templateLanguage?: string;
        templateVariables?: Record<string, string>;
      };
      return {
        ...common,
        kind: 'template',
        template: {
          name: meta.templateName ?? '',
          language: meta.templateLanguage ?? 'en',
          variables: meta.templateVariables ?? {},
        },
      };
    }
    default:
      throw new Error(`A ${row.kind} message cannot be sent`);
  }
}

/** The message row an outbound request becomes (before the sequence, id and time are known). */
export function messageFieldsOf(content: OutboundContent): {
  kind: MessageRow['kind'];
  body: string | null;
  media: { key: string; mime: string; size: number; name: string; sha256: string } | null;
  meta: Record<string, unknown>;
  templateId: number | null;
} {
  switch (content.kind) {
    case 'text':
      return { kind: 'text', body: content.body, media: null, meta: {}, templateId: null };
    case 'media':
      return {
        kind: kindOfFileMime(content.media.mime),
        body: content.caption?.trim() || null,
        media: content.media,
        meta: {},
        templateId: null,
      };
    case 'template':
      return {
        kind: 'template',
        body: content.body,
        media: null,
        meta: {
          templateName: content.name,
          templateLanguage: content.language,
          templateVariables: content.variables,
        },
        templateId: content.templateId ?? null,
      };
  }
}
