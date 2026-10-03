import type { MessageContactCard, MessageInteractive, MessageMediaState } from '@crm/contracts';

/**
 * What a message's file looks like to the reader. An inbound file is first announced and then copied from the provider by a
 * background job, so a message can exist for a while without its bytes: `pending` shows "Downloading", `failed` shows "Could not
 * download" with Retry when a retry can help, `ready` is the normal renderer, `none` is a message with no file at all.
 */
export type MediaView = 'none' | 'ready' | 'pending' | 'failed';

const FILE_KINDS: ReadonlySet<string> = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
]);

export interface MediaViewInput {
  kind: string;
  media: unknown | null;
  mediaState?: MessageMediaState | null;
}

export function mediaView(m: MediaViewInput): MediaView {
  if (!FILE_KINDS.has(m.kind)) return 'none';
  if (m.mediaState === 'pending') return 'pending';
  if (m.mediaState === 'failed') return 'failed';
  return m.media ? 'ready' : 'none';
}

/** True while some message of a thread is still waiting for its file (the thread then asks again for the tail now and then). */
export function anyMediaPending(messages: readonly MediaViewInput[]): boolean {
  return messages.some((m) => mediaView(m) === 'pending');
}

/** Why a download failed, in the words a reader needs; the codes are the media pipeline's (`MEDIA_FAILURE` in the API). */
export const MEDIA_FAILURE_KINDS = ['expired', 'auth', 'tooLarge', 'rejected', 'download'] as const;
export type MediaFailureKind = (typeof MEDIA_FAILURE_KINDS)[number];

const MEDIA_FAILURE_KIND: Record<string, MediaFailureKind> = {
  MEDIA_EXPIRED: 'expired',
  MEDIA_AUTH_FAILED: 'auth',
  MEDIA_NO_CREDENTIALS: 'auth',
  MEDIA_TOO_LARGE: 'tooLarge',
  MEDIA_REJECTED: 'rejected',
  MEDIA_URL_REJECTED: 'rejected',
};

/** Anything not named (a cut connection, a checksum mismatch, an answer nobody expected) is a download that may work next time. */
export function mediaFailureKind(code: string | null | undefined): MediaFailureKind {
  return (code && MEDIA_FAILURE_KIND[code.trim().toUpperCase()]) || 'download';
}

/**
 * Whether Retry can change anything: a file Meta no longer has, one that is too large, or one refused for safety stays that way; a
 * token problem needs the channel reconnected first, so Retry is offered but the hint says to reconnect.
 */
export const mediaRetryHelps = (kind: MediaFailureKind): boolean =>
  kind === 'download' || kind === 'auth';

/** The interactive answer to show as a chip: the stored reply, or (for a message of that kind) its text. */
export function interactiveChip(m: {
  kind: string;
  body: string | null;
  interactive?: MessageInteractive | null;
}): { type: 'button' | 'list'; title: string; description: string | null } | null {
  if (m.interactive?.title) {
    return {
      type: m.interactive.type === 'list_reply' ? 'list' : 'button',
      title: m.interactive.title,
      description: m.interactive.description?.trim() || null,
    };
  }
  if (m.kind === 'interactive' && m.body?.trim()) {
    return { type: 'button', title: m.body.trim(), description: null };
  }
  return null;
}

/** The shared contacts of a message: the stored cards, or (for a contact message with none) its text as a name. */
export function contactCards(m: {
  kind: string;
  body: string | null;
  contacts?: MessageContactCard[] | null;
}): { name: string | null; phones: string[] }[] {
  if (m.contacts && m.contacts.length > 0) {
    return m.contacts.map((c) => ({ name: c.name?.trim() || null, phones: c.phones }));
  }
  if (m.kind === 'contact' && m.body?.trim()) return [{ name: m.body.trim(), phones: [] }];
  return [];
}
