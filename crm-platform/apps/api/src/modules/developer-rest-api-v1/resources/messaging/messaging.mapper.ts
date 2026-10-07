import {
  V1_CHANNEL_CODES,
  type V1Conversation,
  type V1Device,
  type V1Message,
  type V1MessageStatus,
} from '@crm/contracts';
import { digitsOf } from './send-plan';

/** A message with what the public shape needs from its thread and channel. */
export interface MessageReadRow {
  uuid: string;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  mediaKey: string | null;
  mediaMime: string | null;
  mediaName: string | null;
  status: string;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: Date;
  /** The thread's peer on its channel. */
  peerKey: string;
  /** The business number of the channel the thread runs on. */
  channelAddress: string | null;
}

/** Our `queued` is Reference's `pending`; the rest of the vocabulary is shared. */
export function publicStatus(status: string): V1MessageStatus {
  switch (status) {
    case 'queued':
      return 'pending';
    case 'sent':
    case 'delivered':
    case 'read':
    case 'failed':
    case 'received':
      return status;
    default:
      return 'pending';
  }
}

const PASS_THROUGH_TYPES = new Set([
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
]);

/** `media_type` of Reference: the file or location kind, `text` for everything that is words (templates and buttons included). */
export const publicType = (kind: string): string => (PASS_THROUGH_TYPES.has(kind) ? kind : 'text');

/** Meta's typed code (131047) comes out as a number; a platform code (`AUTH_SEND_HALTED`) stays text. */
export function publicErrorCode(code: string | null): number | string | null {
  if (code === null || code === '') return null;
  return /^\d{1,9}$/.test(code) ? Number(code) : code;
}

/** For our messages the recipient; for a customer's message the business number it came to (Reference listed it that way). */
export function recipientOf(
  row: Pick<MessageReadRow, 'direction' | 'peerKey' | 'channelAddress'>,
): string | null {
  if (row.direction === 'out') return row.peerKey;
  const digits = row.channelAddress ? digitsOf(row.channelAddress) : '';
  return digits === '' ? null : digits;
}

export function toV1Message(
  row: MessageReadRow,
  mediaLink: (row: MessageReadRow) => string | null,
): V1Message {
  return {
    id: row.uuid,
    to: recipientOf(row),
    type: publicType(row.kind),
    status: publicStatus(row.status),
    failure_reason: row.failureReason,
    error_code: publicErrorCode(row.failureCode),
    body: row.body,
    media_url: row.mediaKey ? mediaLink(row) : null,
    created_at: row.createdAt.toISOString(),
  };
}

export interface ConversationReadRow {
  uuid: string;
  peerKey: string;
  title: string;
  preview: string | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  channelKind: string;
  /** Status of the newest message we sent on the thread, if there is one. */
  lastOutboundStatus: string | null;
}

/** The send state Reference kept on a thread: failed when the last send failed, pending until something went out, else sent. */
export function threadSendStatus(lastOutbound: string | null): 'pending' | 'sent' | 'failed' {
  if (lastOutbound === null || lastOutbound === 'queued') return 'pending';
  return lastOutbound === 'failed' ? 'failed' : 'sent';
}

export function channelCode(kind: string): string {
  return (V1_CHANNEL_CODES as Record<string, string>)[kind] ?? kind;
}

export function toV1Conversation(row: ConversationReadRow): V1Conversation {
  const digits = digitsOf(row.peerKey.split('@')[0] ?? '');
  return {
    id: row.uuid,
    contact: digits === '' ? null : digits,
    name: row.title,
    last_message: row.preview,
    last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    unread: row.unreadCount,
    status: threadSendStatus(row.lastOutboundStatus),
    channel: channelCode(row.channelKind),
  };
}

export interface DeviceReadRow {
  uuid: string;
  name: string | null;
  countryCode: string | null;
  phone: string | null;
  status: string;
  active: boolean;
  lastSeenAt: Date | null;
}

export interface ConnectionReadRow {
  uuid: string;
  provider: string;
  displayLabel: string | null;
  verifiedName: string | null;
  phone: string | null;
  status: string;
  connectedAt: Date | null;
}

/** An unofficial number: the engine is always `unofficial` and the library behind it is never named. */
export function toV1Device(row: DeviceReadRow): V1Device {
  return {
    id: row.uuid,
    name: row.name ?? '',
    phone: digitsOf(`${row.countryCode ?? ''}${row.phone ?? ''}`),
    engine: 'unofficial',
    status: row.status,
    active: row.active,
    last_seen_at: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
  };
}

const capitalise = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

/** A Cloud API or Twilio connection in the shape of a device: connected or not, active when connected. */
export function toV1Connection(row: ConnectionReadRow): V1Device {
  const connected = row.status === 'connected';
  const digits = row.phone ? digitsOf(row.phone) : '';
  return {
    id: row.uuid,
    name: row.displayLabel || row.verifiedName || capitalise(row.provider),
    phone: digits === '' ? null : digits,
    engine: row.provider === 'twilio' ? 'twilio' : 'whatsapp_cloud',
    status: connected ? 'connected' : 'disconnected',
    active: connected,
    last_seen_at: row.connectedAt ? row.connectedAt.toISOString() : null,
  };
}
