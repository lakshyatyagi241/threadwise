import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  MESSAGE_HISTORY_SOURCES,
  type MessageHistoryEntityKind,
  type MessageHistoryInsights,
  type MessageHistoryRow,
  type MessageHistoryRowStatus,
  type MessageHistorySource,
  type MessageHistorySummary,
  type MessageHistoryType,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  encodeCursor,
  kpiFigures,
  maskRecipient,
  previewOf,
  type HistoryCursor,
  type RawCounts,
  type VolumeBucket,
  bucketUnit,
} from './message-history-rules';
import {
  costSql,
  countsSql,
  feedSql,
  firstResponseSql,
  pageSql,
  topConversationsSql,
  typeMixSql,
  volumeSql,
  type HistoryContext,
  type HistorySelection,
} from './message-history.query';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const SOURCES = new Set<string>(MESSAGE_HISTORY_SOURCES);
const ROW_STATUSES = new Set(['queued', 'sent', 'delivered', 'read', 'failed', 'received']);

/** The id a row has on the wire: the first letter of its table and its uuid. */
export const historyId = (kind: MessageHistoryEntityKind, uuid: string): string =>
  `${kind === 'message' ? 'm' : kind[0]}:${uuid}`;

export const ENTITY_OF_PREFIX = {
  m: 'message',
  b: 'broadcast',
  c: 'campaign',
  s: 'scheduled',
} as const satisfies Record<string, MessageHistoryEntityKind>;

/** A row of the feed as a raw database row -> the contract's row. The recipient is masked here, once, for every consumer. */
export function toHistoryRow(r: Raw): MessageHistoryRow {
  const kind = r.entity_kind as MessageHistoryEntityKind;
  const source = SOURCES.has(String(r.source)) ? (r.source as MessageHistorySource) : 'other';
  const status = (
    ROW_STATUSES.has(String(r.status)) ? r.status : r.direction === 'in' ? 'received' : 'queued'
  ) as MessageHistoryRowStatus;
  const failed = status === 'failed' || str(r.fail_code) !== null || str(r.fail_reason) !== null;
  const entityId = str(r.entity_uuid);
  const channelId = str(r.channel_uuid);
  const templateId = str(r.template_uuid);
  return {
    id: historyId(kind, String(r.uid)) as MessageHistoryRow['id'],
    entityKind: kind,
    source,
    direction: r.direction === 'in' ? 'in' : 'out',
    status,
    type: r.type as MessageHistoryType,
    at: new Date(String(r.at_text)).toISOString(),
    contact: { id: str(r.contact_uuid), name: str(r.contact_name) },
    recipient: maskRecipient(str(r.phone), r.phone_open === true),
    channel: channelId
      ? { id: channelId, kind: String(r.channel_kind), name: String(r.channel_name) }
      : null,
    preview: previewOf(str(r.body)),
    mediaName: str(r.media_name),
    template: templateId ? { id: templateId, name: String(r.template_name ?? '') } : null,
    failure: failed ? { code: str(r.fail_code), reason: str(r.fail_reason) } : null,
    cost:
      r.cost_minor === null || r.cost_minor === undefined
        ? null
        : {
            minor: num(r.cost_minor),
            currency: str(r.cost_currency),
            status: String(r.cost_status ?? 'charged'),
          },
    entity:
      kind !== 'message' && entityId
        ? { kind, id: entityId, name: String(r.entity_name ?? '') }
        : null,
    conversationId: str(r.conv_uuid),
  };
}

/** The cursor that resumes after a raw row of the feed. */
export const cursorOf = (r: Raw): HistoryCursor => ({
  at: String(r.at_text),
  rank: Number(r.rank),
  id: Number(r.id),
});

/**
 * The SQL of Message History: pages, counts and charts over the feed built by `message-history.query.ts`. Every method takes the
 * transaction it runs in; the caller's visibility arrives as a `HistoryContext`, so nothing here knows who is asking.
 */
@Injectable()
export class MessageHistoryRepository {
  /** `limit` rows after the cursor, newest first, and whether more follow. */
  async page(
    tx: Tx,
    ctx: HistoryContext,
    sel: HistorySelection,
    cursor: HistoryCursor | null,
    limit: number,
  ): Promise<{ rows: Raw[]; next: string | null }> {
    const res = await tx.execute(pageSql(ctx, sel, 'row', cursor, limit));
    const all = rowsOf(res);
    const rows = all.slice(0, limit);
    return {
      rows,
      next:
        all.length > limit && rows.length > 0
          ? encodeCursor(cursorOf(rows[rows.length - 1]!))
          : null,
    };
  }

  /** One row by the table it is in and its uuid, with everything the drawer shows; null when it does not exist or is not visible. */
  async detail(
    tx: Tx,
    ctx: HistoryContext,
    sel: HistorySelection,
    kind: MessageHistoryEntityKind,
    uuid: string,
  ): Promise<Raw | null> {
    if (kind !== 'message' && !ctx.bulk) return null;
    const res = await tx.execute(
      sql`SELECT * FROM (${feedSql(ctx, sel, {
        level: 'detail',
        noWindow: true,
        only: uuid,
        ignoreNarrow: true,
        entities: [kind],
      })}) d LIMIT 1`,
    );
    return rowsOf(res)[0] ?? null;
  }

  async summary(
    tx: Tx,
    ctx: HistoryContext,
    sel: HistorySelection,
    previous: HistorySelection,
  ): Promise<Omit<MessageHistorySummary, 'window'>> {
    const now = rowsOf(await tx.execute(countsSql(ctx, sel)))[0] ?? {};
    const before = rowsOf(await tx.execute(countsSql(ctx, previous)))[0] ?? {};
    const counts: RawCounts = {
      total: num(now.total),
      queued: num(now.queued),
      sentStatus: num(now.sent_status),
      delivered: num(now.delivered),
      read: num(now.read),
      failed: num(now.failed),
      received: num(now.received),
    };
    const reply = rowsOf(await tx.execute(firstResponseSql(ctx, sel)))[0]?.seconds;
    let cost: MessageHistorySummary['cost'] = null;
    if (ctx.cost) {
      cost = rowsOf(await tx.execute(costSql(ctx, sel))).map((r) => ({
        currency: str(r.currency),
        minor: num(r.minor),
        messages: num(r.messages),
      }));
    }
    return {
      ...kpiFigures(counts, num(before.total)),
      avgFirstResponseSeconds: reply === null || reply === undefined ? null : Number(reply),
      cost,
    };
  }

  async insights(
    tx: Tx,
    ctx: HistoryContext,
    sel: HistorySelection,
    o: { bucket: VolumeBucket; tz: string; seriesFrom: Date },
  ): Promise<Omit<MessageHistoryInsights, 'bucket' | 'tz'>> {
    const volume = rowsOf(
      await tx.execute(volumeSql(ctx, sel, bucketUnit(o.bucket), o.tz, o.seriesFrom)),
    ).map((r) => ({
      at: String(r.at),
      sent: num(r.sent),
      received: num(r.received),
      failed: num(r.failed),
    }));
    const mix = { text: 0, autoReply: 0, campaign: 0, broadcast: 0, scheduled: 0, media: 0 };
    for (const r of rowsOf(await tx.execute(typeMixSql(ctx, sel)))) {
      const n = num(r.n);
      switch (r.type) {
        case 'auto_reply':
          mix.autoReply += n;
          break;
        case 'campaign':
          mix.campaign += n;
          break;
        case 'broadcast':
          mix.broadcast += n;
          break;
        case 'scheduled':
          mix.scheduled += n;
          break;
        case 'image':
        case 'video':
        case 'audio':
        case 'document':
        case 'location':
          mix.media += n;
          break;
        default:
          mix.text += n;
      }
    }
    const top = rowsOf(await tx.execute(topConversationsSql(ctx, sel, 4))).map((r) => ({
      conversationId: String(r.conversation_uuid),
      name: str(r.name) ?? maskRecipient(str(r.phone), r.phone_open === true).value ?? '',
      messages: num(r.n),
      lastAt: iso(r.last_at) ?? new Date(0).toISOString(),
    }));
    return { volume, typeMix: mix, topConversations: top };
  }
}
