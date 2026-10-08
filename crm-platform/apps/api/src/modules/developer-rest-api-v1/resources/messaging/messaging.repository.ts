import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { buildPage, decodeCursor } from '../../../../common/pagination/cursor';
import type { PageInfo } from '@crm/contracts';
import type {
  ConnectionReadRow,
  ConversationReadRow,
  DeviceReadRow,
  MessageReadRow,
} from './messaging.mapper';
import type { SenderCandidate } from './sender-resolution';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const date = (v: unknown): Date | null => (v ? new Date(v as string) : null);

/** The database's own microsecond-precision instant, so a cursor never drops or repeats rows that share a millisecond. */
const ISO = (column: string): SQL =>
  sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

const boundOf = (cursor: string | undefined): { at: string; id: number } | null => {
  if (!cursor) return null;
  const c = decodeCursor(cursor);
  return { at: c.createdAtIso ?? c.createdAt.toISOString(), id: c.id };
};

const MESSAGE_COLUMNS = sql`
  m.id, m.uuid, m.direction, m.kind, m.body, m.media_key, m.media_mime, m.media_name, m.status, m.failure_code, m.failure_reason,
  m.created_at, ${ISO('m.created_at')} AS created_at_iso, c.peer_key, ch.display_address AS channel_address`;

const MESSAGE_FROM = sql`
  FROM messages m
  JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
  JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id`;

/** What the history shows: a deleted-for-everyone message and the thread's own system lines (a call bubble) are not messages a client sent or got. */
const VISIBLE = sql`m.deleted_at IS NULL AND m.kind <> 'system'`;

type MessageWithPaging = MessageReadRow & { id: number; createdAt: Date; createdAtIso: string };

const toMessage = (r: Raw): MessageWithPaging => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  direction: r.direction as 'in' | 'out',
  kind: r.kind as string,
  body: str(r.body),
  mediaKey: str(r.media_key),
  mediaMime: str(r.media_mime),
  mediaName: str(r.media_name),
  status: r.status as string,
  failureCode: str(r.failure_code),
  failureReason: str(r.failure_reason),
  createdAt: new Date(r.created_at as string),
  createdAtIso: r.created_at_iso as string,
  peerKey: r.peer_key as string,
  channelAddress: str(r.channel_address),
});

export interface Paged<T> {
  items: T[];
  page: PageInfo;
}

/**
 * The reads of the messaging group (TW-API-111 to 117). Nothing in the platform lists a workspace's messages, threads or numbers for an API
 * key: the inbox's own reads are the signed-in agent's (grants, assignment, saved views) and the message facade pages one thread, oldest
 * first. So these are plain SELECTs on the chat and device tables, each `org_id`-scoped and behind RLS, and none of them writes.
 */
@Injectable()
export class MessagingRepository {
  /** Newest first, `(created_at, id)` as the cursor. `conversationId` narrows to one thread. */
  async messages(
    tx: Tx,
    orgId: number,
    q: { limit: number; cursor?: string; conversationId?: number },
  ): Promise<Paged<MessageWithPaging>> {
    const bound = boundOf(q.cursor);
    const res = await tx.execute(sql`
      SELECT ${MESSAGE_COLUMNS}
      ${MESSAGE_FROM}
      WHERE m.org_id = ${orgId} AND ${VISIBLE}
        ${q.conversationId === undefined ? sql`` : sql`AND m.conversation_id = ${q.conversationId}`}
        ${bound ? sql`AND (m.created_at, m.id) < (${bound.at}::timestamptz, ${bound.id})` : sql``}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT ${q.limit + 1}`);
    return buildPage(rowsOf(res).map(toMessage), q.limit);
  }

  async messageByUuid(tx: Tx, orgId: number, uuid: string): Promise<MessageWithPaging | null> {
    const res = await tx.execute(sql`
      SELECT ${MESSAGE_COLUMNS}
      ${MESSAGE_FROM}
      WHERE m.org_id = ${orgId} AND m.uuid = ${uuid} AND ${VISIBLE}
      LIMIT 1`);
    const row = rowsOf(res)[0];
    return row ? toMessage(row) : null;
  }

  async statusOfMessage(tx: Tx, orgId: number, uuid: string): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT status FROM messages WHERE org_id = ${orgId} AND uuid = ${uuid} LIMIT 1`,
    );
    return str(rowsOf(res)[0]?.status);
  }

  async conversationId(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid} LIMIT 1`,
    );
    const row = rowsOf(res)[0];
    return row ? Number(row.id) : null;
  }

  /** Most recently active first; a thread nobody has written in yet is placed by when it was made. */
  async conversations(
    tx: Tx,
    orgId: number,
    q: { limit: number; cursor?: string },
  ): Promise<Paged<ConversationReadRow & { id: number; createdAt: Date; createdAtIso: string }>> {
    const bound = boundOf(q.cursor);
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.peer_key, c.title, c.preview, c.last_message_at, c.unread_count, ch.kind AS channel_kind,
             coalesce(c.last_message_at, c.created_at) AS sort_at,
             ${ISO('coalesce(c.last_message_at, c.created_at)')} AS sort_at_iso,
             (SELECT m.status FROM messages m
               WHERE m.org_id = c.org_id AND m.conversation_id = c.id AND m.direction = 'out'
               ORDER BY m.seq DESC LIMIT 1) AS last_outbound_status
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId}
        ${bound ? sql`AND (coalesce(c.last_message_at, c.created_at), c.id) < (${bound.at}::timestamptz, ${bound.id})` : sql``}
      ORDER BY coalesce(c.last_message_at, c.created_at) DESC, c.id DESC
      LIMIT ${q.limit + 1}`);
    return buildPage(
      rowsOf(res).map((r) => ({
        id: Number(r.id),
        uuid: r.uuid as string,
        peerKey: r.peer_key as string,
        title: r.title as string,
        preview: str(r.preview),
        lastMessageAt: date(r.last_message_at),
        unreadCount: Number(r.unread_count),
        channelKind: r.channel_kind as string,
        lastOutboundStatus: str(r.last_outbound_status),
        createdAt: new Date(r.sort_at as string),
        createdAtIso: r.sort_at_iso as string,
      })),
      q.limit,
    );
  }

  /** Unofficial numbers, active ones first and the newest first (Reference's order). */
  async devices(tx: Tx, orgId: number): Promise<Array<DeviceReadRow>> {
    const res = await tx.execute(sql`
      SELECT uuid, device_name, country_code, phone_number, status, active, last_seen_at
      FROM devices WHERE org_id = ${orgId}
      ORDER BY active DESC, id DESC`);
    return rowsOf(res).map(toDevice);
  }

  async deviceByUuid(tx: Tx, orgId: number, uuid: string): Promise<DeviceReadRow | null> {
    const res = await tx.execute(sql`
      SELECT uuid, device_name, country_code, phone_number, status, active, last_seen_at
      FROM devices WHERE org_id = ${orgId} AND uuid = ${uuid} LIMIT 1`);
    const row = rowsOf(res)[0];
    return row ? toDevice(row) : null;
  }

  /** Cloud API and Twilio connections, the primary first. Other provider rows (ads, social) are not WhatsApp numbers and are not listed. */
  async connections(tx: Tx, orgId: number): Promise<Array<ConnectionReadRow>> {
    const res = await tx.execute(sql`
      SELECT uuid, provider, display_label, meta_json ->> 'verified_name' AS verified_name, phone_number, status, connected_at
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio')
      ORDER BY is_primary DESC, id DESC`);
    return rowsOf(res).map(toConnection);
  }

  async connectionByUuid(tx: Tx, orgId: number, uuid: string): Promise<ConnectionReadRow | null> {
    const res = await tx.execute(sql`
      SELECT uuid, provider, display_label, meta_json ->> 'verified_name' AS verified_name, phone_number, status, connected_at
      FROM wa_provider_configs
      WHERE org_id = ${orgId} AND provider IN ('waba', 'twilio') AND uuid = ${uuid} LIMIT 1`);
    const row = rowsOf(res)[0];
    return row ? toConnection(row) : null;
  }

  /** Every number that could send, with the inbox channel that sends for it. */
  async senders(tx: Tx, orgId: number): Promise<SenderCandidate[]> {
    const devices = await tx.execute(sql`
      SELECT d.uuid, d.id, d.status, d.active, ch.uuid AS channel_uuid, ch.kind AS channel_kind, ch.status AS channel_status
      FROM devices d
      LEFT JOIN channels ch ON ch.org_id = d.org_id AND ch.kind = 'whatsapp_qr' AND ch.external_id = d.uuid::text
      WHERE d.org_id = ${orgId}`);
    const configs = await tx.execute(sql`
      SELECT p.uuid, p.id, p.provider, p.is_primary, p.connected_at, ch.uuid AS channel_uuid, ch.kind AS channel_kind,
             ch.status AS channel_status
      FROM wa_provider_configs p
      LEFT JOIN channels ch ON ch.org_id = p.org_id AND ch.kind = 'whatsapp_cloud' AND ch.waba_config_id = p.id
      WHERE p.org_id = ${orgId} AND p.provider IN ('waba', 'twilio')`);
    return [
      ...rowsOf(devices).map((r): SenderCandidate => ({
        id: r.uuid as string,
        source: 'device',
        provider: 'baileys',
        channelUuid: str(r.channel_uuid),
        channelKind: str(r.channel_kind),
        channelConnected: r.channel_status === 'connected',
        deviceStatus: str(r.status),
        active: r.active === true,
        recency: Number(r.id),
        isPrimary: false,
        connectedAt: null,
      })),
      ...rowsOf(configs).map((r): SenderCandidate => ({
        id: r.uuid as string,
        source: 'config',
        provider: r.provider as string,
        channelUuid: str(r.channel_uuid),
        channelKind: str(r.channel_kind),
        channelConnected: r.channel_status === 'connected',
        deviceStatus: null,
        active: r.channel_status === 'connected',
        recency: Number(r.id),
        isPrimary: r.is_primary === true,
        connectedAt: date(r.connected_at),
      })),
    ];
  }
}

const toDevice = (r: Raw): DeviceReadRow => ({
  uuid: r.uuid as string,
  name: str(r.device_name),
  countryCode: str(r.country_code),
  phone: str(r.phone_number),
  status: r.status as string,
  active: r.active === true,
  lastSeenAt: date(r.last_seen_at),
});

const toConnection = (r: Raw): ConnectionReadRow => ({
  uuid: r.uuid as string,
  provider: r.provider as string,
  displayLabel: str(r.display_label),
  verifiedName: str(r.verified_name),
  phone: str(r.phone_number),
  status: r.status as string,
  connectedAt: date(r.connected_at),
});
