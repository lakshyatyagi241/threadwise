import type { MessageResponse } from '@crm/contracts';
import type { MessageRow } from './messages.repository';

/** Mints the short-lived url of a stored file for one reader; null leaves the url out (the realtime payload has no single reader). */
export type MediaLinker = (row: MessageRow) => string | null;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

const MEDIA_KINDS: ReadonlySet<string> = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
]);

/**
 * Whether a message's file is there: `ready` once it is stored, `pending` while the `media-fetch` job still has it to copy, `failed`
 * when the provider's file could not be had (the job gave up, the platform refused the type, or the inline copy failed). Null for a
 * message that carries no file.
 */
function mediaStateOf(row: MessageRow): 'pending' | 'ready' | 'failed' | null {
  if (row.mediaKey) return 'ready';
  if (!MEDIA_KINDS.has(row.kind) || row.direction !== 'in') return null;
  return row.meta.mediaStatus === 'pending' ? 'pending' : 'failed';
}

function mediaFailureOf(row: MessageRow): { code: string | null; reason: string | null } {
  const f = row.meta.mediaFailure as { code?: unknown; reason?: unknown } | undefined;
  if (f && typeof f === 'object') return { code: str(f.code), reason: str(f.reason) };
  // The inline copy (the simulator) records only a short cause.
  const cause = str(row.meta.mediaError);
  return { code: cause ? `MEDIA_${cause.toUpperCase()}` : null, reason: null };
}

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The shared contact cards of an inbound `contact` message (kept in the meta by the channel adapter). */
function contactsOf(row: MessageRow): MessageResponse['contacts'] {
  if (row.kind !== 'contact' || !Array.isArray(row.meta.contacts)) return null;
  return (row.meta.contacts as Array<Record<string, unknown>>).map((c) => ({
    name: str(c.name),
    phones: strArray(c.phones),
    emails: strArray(c.emails),
    org: str(c.org),
  }));
}

/** What the customer picked from a button, a list or a template quick reply. */
function interactiveOf(row: MessageRow): MessageResponse['interactive'] {
  const i = row.meta.interactive as Record<string, unknown> | undefined;
  if (row.kind !== 'interactive' || !i || typeof i !== 'object') return null;
  const type = i.type;
  if (type !== 'button_reply' && type !== 'list_reply' && type !== 'button') return null;
  return { type, id: str(i.id), title: str(i.title) ?? '', description: str(i.description) };
}

/** The buttons of an interactive message we sent. */
function sentInteractiveOf(row: MessageRow): MessageResponse['sentInteractive'] {
  const i = row.meta.sentInteractive as Record<string, unknown> | undefined;
  if (row.kind !== 'interactive' || row.direction !== 'out' || !i || typeof i !== 'object')
    return null;
  const common = { header: str(i.header), body: str(i.body) ?? '', footer: str(i.footer) };
  if (i.type === 'cta_url') {
    return {
      type: 'cta_url',
      ...common,
      buttons: [{ title: str(i.text) ?? '', url: str(i.url) }],
    };
  }
  if (i.type === 'list' && Array.isArray(i.sections)) {
    return {
      type: 'list',
      ...common,
      buttons: [{ title: str(i.button) ?? '', url: null }],
      sections: (i.sections as Array<Record<string, unknown>>).map((sec) => ({
        title: str(sec.title),
        rows: ((sec.rows as Array<Record<string, unknown>> | undefined) ?? []).map((r) => ({
          title: str(r.title) ?? '',
          description: str(r.description),
        })),
      })),
    };
  }
  if (i.type !== 'buttons' || !Array.isArray(i.buttons)) return null;
  return {
    type: 'buttons',
    ...common,
    buttons: (i.buttons as Array<Record<string, unknown>>).map((b) => ({
      title: str(b.title) ?? '',
      url: null,
    })),
  };
}

/** The ad or link that opened the chat (Meta `referral`), on the message that carried it. */
function referralOf(row: MessageRow): MessageResponse['referral'] {
  const r = row.meta.referral as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  return {
    sourceType: str(r.sourceType),
    sourceUrl: str(r.sourceUrl),
    sourceId: str(r.sourceId),
    headline: str(r.headline),
    body: str(r.body),
  };
}

/** The member who posted in a WhatsApp group (`meta.group`, set by the inbound ingest). */
function groupAuthorOf(row: MessageRow): MessageResponse['group'] {
  const g = row.meta.group as Record<string, unknown> | undefined;
  if (!g || typeof g !== 'object' || row.direction !== 'in') return undefined;
  return { participant: str(g.participant), senderName: str(g.senderName) };
}

/** The tally of a message sent to a WhatsApp group (`meta.group_delivery`, folded from Meta's per-member statuses). */
function groupDeliveryOf(row: MessageRow): MessageResponse['groupDelivery'] {
  const d = row.meta.group_delivery as Record<string, unknown> | undefined;
  if (!d || typeof d !== 'object' || row.direction !== 'out') return undefined;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { deliveredTo: n(d.delivered_to), billable: n(d.billable_count), free: n(d.free_count) };
}

const humanType = (t: string): string => {
  const s = t.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** A Flow answer as `label: value` lines (rows stored before the adapter did this still carry the raw JSON). */
function flowLines(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const lines = Object.entries(v as Record<string, unknown>)
      .filter(([k, x]) => k !== 'flow_token' && x !== null && x !== undefined && x !== '')
      .map(
        ([k, x]) =>
          `${k.replace(/_/g, ' ')}: ${typeof x === 'object' ? JSON.stringify(x) : String(x)}`,
      );
    return lines.length ? lines.join('\n').slice(0, 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Rows stored before the adapter understood a type hold a placeholder ("[Interactive · call_permission_reply]"). They are read as
 * what they are now, so old threads match new ones without a data migration.
 */
function legacyView(row: MessageRow): {
  kind: MessageRow['kind'];
  body: string | null;
  interactive: MessageResponse['interactive'];
} | null {
  const m = row.meta;
  if (row.direction !== 'in') return null;
  if (m.interactiveType === 'call_permission_reply' && row.kind === 'text') {
    const title = 'Call permission reply';
    return {
      kind: 'interactive',
      body: title,
      interactive: { type: 'button_reply', id: null, title, description: null },
    };
  }
  if (row.kind === 'interactive' && m.flowResponse !== undefined && !m.interactive) {
    const lines = flowLines(m.flowResponse);
    if (lines) return { kind: row.kind, body: lines, interactive: null };
  }
  if (
    row.kind === 'text' &&
    m.unsupported === true &&
    typeof m.rawType === 'string' &&
    /^\[[A-Za-z]+_[a-z_]+ message\]$/.test(row.body ?? '')
  ) {
    return { kind: row.kind, body: `[${humanType(m.rawType)} message]`, interactive: null };
  }
  return null;
}

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

  const mediaState = mediaStateOf(row);
  const legacy = legacyView(row);
  return {
    id: row.uuid,
    conversationId: row.conversationUuid,
    seq: row.seq,
    direction: row.direction,
    kind: legacy?.kind ?? row.kind,
    sender: { kind: row.senderKind, userId: row.senderUserUuid, name: row.senderName },
    body: legacy ? legacy.body : row.body,
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
    mediaState,
    contacts: contactsOf(row),
    interactive: legacy?.interactive ?? interactiveOf(row),
    forwarded: row.meta.forwarded === true ? true : undefined,
    referral: referralOf(row),
    group: groupAuthorOf(row),
    groupDelivery: groupDeliveryOf(row),
    sentInteractive: sentInteractiveOf(row),
    unsupported:
      row.meta.unsupported === true &&
      row.meta.rawType !== 'order' &&
      !(legacy && legacy.kind === 'interactive')
        ? true
        : undefined,
    mediaFailure: mediaState === 'failed' ? mediaFailureOf(row) : null,
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
