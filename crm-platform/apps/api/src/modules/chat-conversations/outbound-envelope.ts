import type { EmailMeta } from '@crm/contracts';
import type { OutboundEmail } from '../../infra/providers/chat-conversations';
import type { OutboundContent } from './conversations.facade';
import { kindOfFileMime } from './message-rules';
import type { MessageRow } from './messages.repository';

/** What a stored message becomes for the dispatcher (which validates it against `outboundEnvelopeSchema`). */
/** The reply extras kept on a queued email message (`messages.meta.emailReply`), so a retry sends the same cc, bcc and subject. */
export interface StoredEmailReply {
  cc: string[];
  bcc: string[];
  subject?: string;
}

const REFERENCES_MAX = 100;

/** `Re: <subject>`, without stacking a second `Re:` on a subject that already has one. */
export function replySubject(original: string | null | undefined): string {
  const subject = (original ?? '').replace(/\s+/g, ' ').trim();
  if (subject === '') return 'Re:';
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

/**
 * What an email adapter needs to answer a thread: recipients, subject and the RFC 5322 threading headers. `inbound` is the thread's
 * newest mail to answer (`meta.email`), `reply` the agent's extras kept on the message. The reply goes to the sender of that mail;
 * `References` is its own chain plus its Message-ID (the earliest id and the newest ones kept when the chain is long). Null when there is
 * no mail to answer: the dispatcher then refuses the message (a thread is only ever started by a customer's mail).
 */
export function emailEnvelopeOf(
  inbound: Pick<EmailMeta, 'subject' | 'from' | 'messageId' | 'references' | 'threadId'> | null,
  reply: Partial<StoredEmailReply> | null | undefined,
  threadId: string,
): OutboundEmail | null {
  if (!inbound) return null;
  const chain = [...inbound.references, inbound.messageId].filter(
    (id, i, all) => id !== '' && all.indexOf(id) === i,
  );
  const references =
    chain.length > REFERENCES_MAX ? [chain[0]!, ...chain.slice(-(REFERENCES_MAX - 1))] : chain;
  return {
    to: [inbound.from.address],
    cc: reply?.cc ?? [],
    bcc: reply?.bcc ?? [],
    subject: reply?.subject?.trim() || replySubject(inbound.subject),
    inReplyTo: inbound.messageId || null,
    references,
    threadId: inbound.threadId || threadId,
  };
}

/** The thread id inside an email conversation's peer key (`t:<threadId>`). */
export const threadIdOfPeerKey = (peerKey: string): string =>
  peerKey.startsWith('t:') ? peerKey.slice(2) : peerKey;

export function envelopeOf(
  row: Pick<
    MessageRow,
    | 'kind'
    | 'body'
    | 'mediaKey'
    | 'mediaMime'
    | 'mediaName'
    | 'mediaSha256'
    | 'meta'
    | 'latitude'
    | 'longitude'
    | 'clientMessageId'
    | 'uuid'
  >,
  peerKey: string,
  replyToProviderMessageId: string | null,
  attempt: number,
  /** Only for a message on an email channel; see `emailEnvelopeOf`. */
  email?: OutboundEmail | null,
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
      return { ...common, kind: 'text', body: row.body ?? '', ...(email ? { email } : {}) };
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
          ...(row.mediaSha256 ? { sha256: row.mediaSha256 } : {}),
          ...(row.body ? { caption: row.body } : {}),
        },
      };
    case 'reaction':
      // The target is the message this row answers; a reaction without a provider id to point at cannot be sent.
      if (!replyToProviderMessageId)
        throw new Error('A reaction needs a message the provider knows');
      return {
        ...common,
        kind: 'reaction',
        reaction: { providerMessageId: replyToProviderMessageId, emoji: row.body ?? '' },
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
    case 'location':
      if (row.latitude === null || row.longitude === null)
        throw new Error('A location needs its coordinates');
      return {
        ...common,
        kind: 'location',
        location: {
          latitude: row.latitude,
          longitude: row.longitude,
          ...(typeof row.meta.locationName === 'string' ? { name: row.meta.locationName } : {}),
          ...(typeof row.meta.locationAddress === 'string'
            ? { address: row.meta.locationAddress }
            : {}),
        },
      };
    case 'contact':
      return {
        ...common,
        kind: 'contacts',
        contacts: (
          (row.meta.contacts as
            | { name: string; phones: string[]; emails: string[]; org?: string | null }[]
            | undefined) ?? []
        ).map((c) => ({
          name: c.name,
          phones: c.phones.map((phone) => ({ phone })),
          emails: c.emails,
          ...(c.org ? { org: c.org } : {}),
        })),
      };
    case 'interactive':
      if (!row.meta.sentInteractive) throw new Error('An interactive message needs its content');
      return { ...common, kind: 'interactive', interactive: row.meta.sentInteractive };
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
  latitude?: number;
  longitude?: number;
} {
  switch (content.kind) {
    case 'text': {
      const extras = content.email;
      const emailReply: StoredEmailReply | null =
        extras && (extras.cc.length > 0 || extras.bcc.length > 0 || extras.subject)
          ? {
              cc: extras.cc,
              bcc: extras.bcc,
              ...(extras.subject ? { subject: extras.subject } : {}),
            }
          : null;
      return {
        kind: 'text',
        body: content.body,
        media: null,
        meta: emailReply ? { emailReply } : {},
        templateId: null,
      };
    }
    case 'media':
      return {
        kind: kindOfFileMime(content.media.mime),
        body: content.caption?.trim() || null,
        media: content.media,
        meta: {},
        templateId: null,
      };
    case 'reaction':
      return {
        kind: 'reaction',
        body: content.emoji.trim() || null,
        media: null,
        meta: {},
        templateId: null,
      };
    case 'location':
      return {
        kind: 'location',
        body: null,
        media: null,
        latitude: content.latitude,
        longitude: content.longitude,
        meta: {
          ...(content.name ? { locationName: content.name } : {}),
          ...(content.address ? { locationAddress: content.address } : {}),
        },
        templateId: null,
      };
    case 'contacts':
      return {
        kind: 'contact',
        body: content.contacts[0]!.name,
        media: null,
        meta: {
          contacts: content.contacts.map((c) => ({
            name: c.name,
            phones: c.phones,
            emails: c.emails,
            org: c.org ?? null,
          })),
        },
        templateId: null,
      };
    case 'interactive':
      return {
        kind: 'interactive',
        body: content.interactive.body,
        media: null,
        meta: { sentInteractive: content.interactive },
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
