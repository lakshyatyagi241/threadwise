import type { NotificationType } from '@crm/contracts';

/**
 * Who is told, and what the bell row says, for the phase 2 notification types (docs/specs/realtime-notifications.md catalogue rows 8 to 10):
 * a personal WhatsApp number's connection, the outcome of a broadcast / campaign / scheduled message, and team chat. Pure functions over
 * ids and facts already read from the database, so every rule is unit-tested without one.
 */

// --- devices (row 8) -----------------------------------------------------------------------------------------------------------

export const DEVICE_NOTIFY_EVENTS = [
  'device.connected',
  'device.disconnected',
  'device.logged_out',
  'device.status_changed',
] as const;

export type DeviceNoticeType = Extract<
  NotificationType,
  'device_connected' | 'device_disconnected' | 'device_logged_out'
>;

/**
 * Which notification (if any) a device event stands for. The transition events (`device.connected|disconnected|logged_out`, raised once per
 * change by the runtime) are the source of truth; `device.status_changed` fires on every report and is only read for the one case the
 * transition events miss: the 90-second sweep that marks a silent worker's device disconnected (`reason: worker_silent`).
 * A disconnect or logout the person asked for themselves (`reason: user`) is not news.
 */
export function deviceNoticeFor(
  eventType: string,
  payload: Record<string, unknown>,
): DeviceNoticeType | null {
  const reason = typeof payload.reason === 'string' ? payload.reason : null;
  switch (eventType) {
    case 'device.connected':
      return 'device_connected';
    case 'device.disconnected':
      return reason === 'user' ? null : 'device_disconnected';
    case 'device.logged_out':
      return reason === 'user' ? null : 'device_logged_out';
    case 'device.status_changed':
      return reason === 'worker_silent' && payload.state === 'disconnected'
        ? 'device_disconnected'
        : null;
    default:
      return null;
  }
}

/** A device that flaps notifies once per this window per person and kind; the reconnect and the next drop inside it stay quiet. */
export const DEVICE_RENOTIFY_MINUTES = 60;
/** "Back online" is only news to someone who heard it went down, so a connect notifies when a drop was announced in this window. */
export const DEVICE_RECOVERY_WINDOW_HOURS = 24;

/** `…1234`: the last four digits only (decision D4). Never the full number, never a QR or a pairing code. */
export function maskedNumber(digits: string | null | undefined): string | null {
  const d = (digits ?? '').replace(/\D+/g, '');
  return d.length >= 4 ? `…${d.slice(-4)}` : null;
}

const DEVICE_REASON_TEXT: Record<string, string> = {
  worker_silent: 'The session stopped responding.',
  proxy_unreachable: 'The proxy could not be reached.',
  session_conflict: 'The number was opened on another device.',
  unlinked_on_phone: 'WhatsApp ended the link from the phone.',
  forbidden: 'WhatsApp ended the link.',
};

export function deviceCopy(
  type: DeviceNoticeType,
  deviceName: string | null,
  masked: string | null,
  reason: string | null,
): { title: string; body: string } {
  const name = deviceName?.trim() || 'WhatsApp number';
  const tail = masked ? ` (${masked})` : '';
  if (type === 'device_connected') {
    return { title: `${name} is back online`, body: `${name}${tail} reconnected.` };
  }
  if (type === 'device_logged_out') {
    return {
      title: `${name} was logged out`,
      body: `WhatsApp ended the link for ${name}${tail}. Scan the QR code again to reconnect.`,
    };
  }
  const why = reason ? DEVICE_REASON_TEXT[reason] : undefined;
  return {
    title: `${name} disconnected`,
    body: `${name}${tail} lost its connection.${why ? ` ${why}` : ''} Open Devices to reconnect.`,
  };
}

// --- broadcast, campaign, scheduled message outcomes (row 9) ---------------------------------------------------------------------

export type SendKind = 'broadcast' | 'campaign' | 'scheduled_message';
export type SendOutcomeType = Extract<
  NotificationType,
  | 'broadcast_completed'
  | 'broadcast_failed'
  | 'campaign_completed'
  | 'campaign_failed'
  | 'scheduled_completed'
  | 'scheduled_failed'
>;

export const SEND_OUTCOME_EVENTS = [
  'broadcast.status_changed',
  'campaign.status_updated',
  'scheduled.status_changed',
] as const;

export const sendKindOf = (eventType: string): SendKind | null =>
  eventType === 'broadcast.status_changed'
    ? 'broadcast'
    : eventType === 'campaign.status_updated'
      ? 'campaign'
      : eventType === 'scheduled.status_changed'
        ? 'scheduled_message'
        : null;

/**
 * The notification a terminal status stands for; null for every other status (running, paused, cancelled...). A broadcast that finished
 * with some failed recipients is still a finished broadcast (the row says how many failed); only `failed` is a failure.
 */
export function sendOutcomeFor(kind: SendKind, status: string): SendOutcomeType | null {
  const prefix = kind === 'scheduled_message' ? 'scheduled' : kind;
  if (status === 'completed') return `${prefix}_completed` as SendOutcomeType;
  if (status === 'completed_with_errors' && kind === 'broadcast') return 'broadcast_completed';
  if (status === 'failed') return `${prefix}_failed` as SendOutcomeType;
  return null;
}

export const isFailureOutcome = (type: SendOutcomeType): boolean => type.endsWith('_failed');

/** The sender, plus the workspace admins when it failed (they keep the workspace running); each person once, never an inactive one. */
export function outcomeRecipients(
  type: SendOutcomeType,
  creatorUserId: number | null,
  adminUserIds: readonly number[],
): number[] {
  const out = new Set<number>();
  if (creatorUserId !== null) out.add(creatorUserId);
  if (isFailureOutcome(type)) for (const id of adminUserIds) out.add(id);
  return [...out];
}

const KIND_LABEL: Record<SendKind, string> = {
  broadcast: 'Broadcast',
  campaign: 'Campaign',
  scheduled_message: 'Scheduled message',
};

export function outcomeCopy(
  kind: SendKind,
  type: SendOutcomeType,
  name: string | null,
  facts: { total?: number; sent?: number; failed?: number; reason?: string | null },
): { title: string; body: string } {
  const label = KIND_LABEL[kind];
  const what = name?.trim() ? `${label} "${name.trim().slice(0, 80)}"` : label;
  if (isFailureOutcome(type)) {
    const why = facts.reason?.trim() ? ` ${facts.reason.trim().slice(0, 200)}` : '';
    return { title: `${label} failed`, body: `${what} failed.${why}`.trim() };
  }
  const failed = facts.failed ?? 0;
  const counts =
    facts.sent !== undefined
      ? ` ${facts.sent} sent${failed > 0 ? `, ${failed} failed` : ''}.`
      : failed > 0
        ? ` ${failed} failed.`
        : '';
  return { title: `${label} finished`, body: `${what} finished.${counts}` };
}

export const sendOutcomeKey = (
  kind: SendKind,
  uuid: string,
  status: string,
  eventId: string,
): string => `${kind}:${uuid}:${status}:${eventId}`;

// --- team chat (row 10) --------------------------------------------------------------------------------------------------------

export const TEAMCHAT_NOTIFY_EVENTS = [
  'teamchat.mention.created',
  'teamchat.message.posted',
] as const;

/** At most one unread row per person and channel: the next mention (or direct message) inside it raises the count. */
export const teamMentionCollapseKey = (channelUuid: string): string => `tcmention:${channelUuid}`;
export const teamDirectCollapseKey = (channelUuid: string): string => `tcdm:${channelUuid}`;

/** Ends in the outbox event id, which the collapsing writer reads back to tell a redelivery from a new event. */
export const teamMentionKey = (messageUuid: string, userUuid: string, eventId: string): string =>
  `tcm:${messageUuid}:${userUuid}:${eventId}`;
export const teamDirectKey = (messageUuid: string, userUuid: string, eventId: string): string =>
  `tcd:${messageUuid}:${userUuid}:${eventId}`;

export interface TeamChatFacts {
  channelType: 'public' | 'private' | 'dm';
  /** The channel's name; a direct message has none worth showing. */
  channelName: string | null;
  authorName: string | null;
}

/**
 * Whether the person should hear about a team chat message at all: they must still belong to the conversation (private and direct
 * channels need a membership row; a public one is open to every member of the workspace), must not be its author, and must not have read
 * it yet (a channel kept open moves the read pointer past each message, so a person looking at it is not alerted).
 */
export function mayHearTeamChat(input: {
  channelType: 'public' | 'private' | 'dm';
  isMember: boolean;
  isAuthor: boolean;
  lastReadMessageId: number;
  messageId: number;
}): boolean {
  if (input.isAuthor) return false;
  if (input.channelType !== 'public' && !input.isMember) return false;
  return input.lastReadMessageId < input.messageId;
}

export function teamMentionCopy(
  f: TeamChatFacts,
  preview: string,
  count: number,
): { title: string; body: string } {
  const author = f.authorName?.trim() || 'Someone';
  const where = f.channelType === 'dm' ? 'a direct message' : `#${f.channelName ?? 'channel'}`;
  if (count > 1) {
    return {
      title: `${count} new mentions in ${where}`,
      body: preview ? `${author}: ${preview}` : `${author} mentioned you.`,
    };
  }
  return {
    title: `${author} mentioned you in ${where}`,
    body: preview || `${author} mentioned you.`,
  };
}

export function teamDirectCopy(
  f: TeamChatFacts,
  preview: string,
  count: number,
): { title: string; body: string } {
  const author = f.authorName?.trim() || 'A teammate';
  if (count > 1) {
    return {
      title: `${count} new messages from ${author}`,
      body: preview || `${author} sent you messages.`,
    };
  }
  return {
    title: `${author} sent you a message`,
    body: preview || `${author} sent you a message.`,
  };
}

/**
 * Plain text, at most 80 characters (the same cut as the conversation previews): a mention token `@[Name](uuid)` shows as `@Name` (the
 * uuid is an id that means nothing to the reader), whitespace is collapsed.
 */
export function teamPreview(body: string | null | undefined): string {
  return (body ?? '')
    .replace(/@\[([^\]]*)\]\([0-9a-fA-F-]{36}\)/g, '@$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
