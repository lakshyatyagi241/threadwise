import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  Api,
  startHarness,
  type Grant,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';

export { Api, startHarness, type Grant, type Harness, type Tenant };

/** What an agent who works the shared inbox holds: read, reply, claim, resolve and note, over every conversation. */
export const AGENT: Grant[] = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
  ['inbox.conversation.resolve', 'all'],
  ['inbox.conversation.note', 'all'],
];

export const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SimChannel {
  id: string;
  kind: string;
  status: string;
  rowVersion: number;
}

export interface SeededConversation {
  /** Internal id, for arranging state with the owner connection. */
  id: number;
  uuid: string;
}

export interface SeedConversation {
  peer?: string;
  title?: string;
  peerName?: string | null;
  status?: string;
  assigneeUserId?: number | null;
  assigneeTeamId?: number | null;
  unread?: number;
  archived?: boolean;
  pinned?: boolean;
  contactId?: number | null;
  /** ISO timestamp (microseconds allowed) of the latest message; omit for a thread with no message. */
  lastMessageAt?: string | null;
  preview?: string | null;
  /** How many inbound messages to create (seq 1..n); the last one carries `lastMessageAt`. */
  messages?: number;
  /** When the customer last wrote (the 24 hour rule's anchor). Defaults to now when there are messages. */
  lastInboundAt?: string | null;
  windowExpiresAt?: string | null;
}

/** Arranges conversations and messages straight in the tables with the owner connection (no pipeline involved). */
export class Inbox {
  private n = 0;

  constructor(
    readonly h: Harness,
    readonly api: Api,
  ) {}

  async channel(token: string, body: Record<string, unknown> = {}): Promise<SimChannel> {
    const res = await this.api
      .as(token)
      .post('/v2/channels/simulator')
      .set('idempotency-key', `sim-${randomUUID()}`)
      .send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as SimChannel;
  }

  async channelId(uuid: string): Promise<number> {
    const r = await this.h.owner.query(`SELECT id FROM channels WHERE uuid = $1`, [uuid]);
    return Number(r.rows[0].id);
  }

  async conversation(
    t: Tenant,
    channelUuid: string,
    c: SeedConversation = {},
  ): Promise<SeededConversation> {
    const channelId = await this.channelId(channelUuid);
    this.n += 1;
    const peer = c.peer ?? `9198${String(10000000 + this.n)}`;
    const count = c.messages ?? 1;
    const last =
      c.lastMessageAt === undefined
        ? new Date(Date.now() - (1000 - this.n) * 1000).toISOString()
        : c.lastMessageAt;
    const lastInbound = c.lastInboundAt === undefined ? (count > 0 ? last : null) : c.lastInboundAt;
    const res = await this.h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, peer_name, title, status, assignee_user_id,
          assignee_team_id, unread_count, archived, pinned_at, contact_id, last_message_at, preview, msg_seq,
          last_inbound_at, window_expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $11 THEN now() ELSE NULL END,$12,$13::timestamptz,$14,$15,
          $16::timestamptz,$17::timestamptz)
       RETURNING id, uuid`,
      [
        t.orgId,
        channelId,
        peer,
        c.peerName ?? null,
        c.title ?? `Customer ${peer}`,
        c.status ?? 'open',
        c.assigneeUserId ?? null,
        c.assigneeTeamId ?? null,
        c.unread ?? 0,
        c.archived ?? false,
        c.pinned ?? false,
        c.contactId ?? null,
        last,
        c.preview === undefined ? 'hello' : c.preview,
        count,
        lastInbound,
        c.windowExpiresAt ?? null,
      ],
    );
    const id = Number(res.rows[0].id);
    for (let seq = 1; seq <= count; seq += 1) {
      await this.message(t, id, seq, {
        createdAt: seq === count && last ? last : undefined,
      });
    }
    return { id, uuid: res.rows[0].uuid as string };
  }

  /** One message row. Inbound by default; `out` makes an agent's message with the given status. */
  async message(
    t: Tenant,
    conversationId: number,
    seq: number,
    m: {
      direction?: 'in' | 'out';
      status?: string;
      body?: string;
      mediaKey?: string;
      createdAt?: string;
      senderUserId?: number;
      failureCode?: string;
    } = {},
  ): Promise<{ id: number; uuid: string }> {
    const out = m.direction === 'out';
    const res = await this.h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, sender_user_id, body, status,
                             media_key, media_mime, media_name, failure_code, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14::timestamptz, now()))
       RETURNING id, uuid`,
      [
        t.orgId,
        conversationId,
        seq,
        out ? 'out' : 'in',
        m.mediaKey ? 'image' : 'text',
        out ? 'agent' : 'customer',
        out ? (m.senderUserId ?? t.adminUserId) : null,
        m.body ?? `message ${seq}`,
        m.status ?? (out ? 'sent' : 'received'),
        m.mediaKey ?? null,
        m.mediaKey ? 'image/png' : null,
        m.mediaKey ? 'photo.png' : null,
        m.failureCode ?? null,
        m.createdAt ?? null,
      ],
    );
    return { id: Number(res.rows[0].id), uuid: res.rows[0].uuid as string };
  }

  async row(uuid: string): Promise<Record<string, unknown>> {
    const r = await this.h.owner.query(`SELECT * FROM conversations WHERE uuid = $1`, [uuid]);
    return r.rows[0] as Record<string, unknown>;
  }

  async version(uuid: string): Promise<number> {
    return Number((await this.row(uuid)).row_version);
  }
}

/** A tiny valid PNG (1x1), so the upload policy's content check passes. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
