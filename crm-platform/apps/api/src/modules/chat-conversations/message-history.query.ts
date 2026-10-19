import { sql, type SQL } from 'drizzle-orm';
import type { MessageHistoryFilters } from '@crm/contracts';
import { rawIdentifier } from '../../common/sql/identifier';
import {
  likeEscape,
  phoneNeedle,
  typeFilterParts,
  type HistoryCursor,
  type HistoryWindow,
} from './message-history-rules';
import { scopeOwnerPredicate } from '../../kernel/rbac/scope';

/**
 * The SQL of Message History: ONE feed over the message stream and the recipient rows of broadcasts, campaigns and scheduled messages.
 *
 * Every branch of the feed produces the same columns (`COLUMNS`, in this order) for the level asked:
 *   slim    what the counts need (kind, direction, status, type, when);
 *   row     what a table row shows (adds who, which channel and template, the text, the failure);
 *   detail  what the drawer shows (adds the moments the row recorded and who sent it).
 *
 * The caller's visibility is data, not code: `conversationVisible` is the SQL condition of `conversationVisible()` on `conversations c`
 * (the inbox's own rule, the one the list and the socket use), `bulk` says whether the recipient rows of broadcasts, campaigns and
 * scheduled messages (which belong to no conversation) are visible at all, and `contacts` says which contacts the caller may read, which
 * decides whether a recipient's number is shown or only searched. Nothing here decides who may see what.
 */

export type Level = 'slim' | 'row' | 'detail';
export type RecordScopeLike = 'all' | 'team' | 'own';

export interface HistoryContext {
  orgId: number;
  /** Joins the visibility condition needs, placed right after `JOIN conversations c` (empty when the condition is TRUE). */
  conversationJoins: SQL;
  /** A condition on `conversations c`: the inbox visibility rule of the caller, or TRUE for a caller who reads every conversation. */
  conversationVisible: SQL;
  /** The caller may see broadcast, campaign and scheduled recipient rows. */
  bulk: boolean;
  /** The caller's `record.contacts.read`: its scope (null: not held), who they are and their teams. */
  contacts: { scope: RecordScopeLike | null; userId: number };
  /** The caller may read the wallet statement: charges are joined to the rows. */
  cost: boolean;
}

export interface HistorySelection {
  window: HistoryWindow;
  /** Which part of the feed (uuids). Applies to the counts as well as to the table. */
  scoping: Pick<
    MessageHistoryFilters,
    'channelId' | 'templateId' | 'campaignId' | 'broadcastId' | 'scheduledId'
  >;
  /** What narrows the table and the charts (Reference's direction tabs, type, search) and what this port adds. */
  narrow: Pick<MessageHistoryFilters, 'dir' | 'type' | 'source' | 'status' | 'q'>;
}

/** The ranks of the branches: part of the cursor, so a page resumes exactly after its last row even when two rows share a moment. */
export const RANK = { message: 0, broadcast: 1, campaign: 2, scheduled: 3 } as const;

/** Every column, in order, with the lowest level that carries it. */
const COLUMNS: ReadonlyArray<readonly [string, Level]> = [
  ['rank', 'slim'],
  ['id', 'slim'],
  ['at', 'slim'],
  ['entity_kind', 'slim'],
  ['source', 'slim'],
  ['direction', 'slim'],
  ['status', 'slim'],
  ['type', 'slim'],
  ['provider_id', 'slim'],
  ['uid', 'row'],
  ['at_text', 'row'],
  ['msg_kind', 'row'],
  ['conv_uuid', 'row'],
  ['contact_uuid', 'row'],
  ['contact_name', 'row'],
  ['phone', 'row'],
  ['phone_open', 'row'],
  ['channel_uuid', 'row'],
  ['channel_kind', 'row'],
  ['channel_name', 'row'],
  ['body', 'row'],
  ['media_name', 'row'],
  ['template_uuid', 'row'],
  ['template_name', 'row'],
  ['fail_code', 'row'],
  ['fail_reason', 'row'],
  ['entity_uuid', 'row'],
  ['entity_name', 'row'],
  ['cost_minor', 'row'],
  ['cost_currency', 'row'],
  ['cost_status', 'row'],
  ['created_at', 'detail'],
  ['sent_at', 'detail'],
  ['delivered_at', 'detail'],
  ['read_at', 'detail'],
  ['failed_at', 'detail'],
  ['sender_kind', 'detail'],
  ['sender_name', 'detail'],
  ['language', 'detail'],
];

const LEVEL_ORDER: Record<Level, number> = { slim: 0, row: 1, detail: 2 };
const included = (level: Level, min: Level): boolean => LEVEL_ORDER[level] >= LEVEL_ORDER[min];

function select(level: Level, values: Record<string, SQL>): SQL {
  const parts: SQL[] = [];
  for (const [name, min] of COLUMNS) {
    if (!included(level, min)) continue;
    const expr = values[name];
    if (!expr) throw new Error(`message history: branch has no column ${name}`);
    parts.push(sql`${expr} AS ${sql.raw(name)}`);
  }
  return sql.join(parts, sql`, `);
}

const utcText = (col: SQL): SQL =>
  sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** The recipient's number as digits only, so a number typed with spaces or dashes is still recognised as a phone number. */
const digitsOf = (col: SQL): SQL => sql`NULLIF(regexp_replace(${col}, '\\D', '', 'g'), '')`;

/** May the caller read this contact? The contact row is `ct` (possibly NULL: a number with no saved contact). */
export function contactOpen(ctx: HistoryContext, ct: string): SQL {
  if (ctx.contacts.scope === null) return sql`FALSE`;
  const c = rawIdentifier(ct);
  // The same rule the contacts list applies (contactScopeCondition: owner or creator, D1), through the one resolver.
  return scopeOwnerPredicate(
    { orgId: ctx.orgId, userId: ctx.contacts.userId },
    ctx.contacts.scope,
    [sql`${c}.owner_id`, sql`${c}.created_by`],
  );
}

/** A saved contact's name: the contact's own, else first and last name. */
const contactName = (ct: string): SQL => {
  const c = rawIdentifier(ct);
  return sql`COALESCE(NULLIF(${c}.name, ''), NULLIF(btrim(concat_ws(' ', ${c}.first_name, ${c}.last_name)), ''))`;
};

// --- the type pill -----------------------------------------------------------------------------------------------------------

/** What sent a message. Inbound messages and an agent's messages are `inbox`; automated ones say so in `meta.source`. */
const MESSAGE_SOURCE = sql`CASE
  WHEN m.direction = 'in' THEN 'inbox'
  WHEN m.meta ->> 'source' IN ('auto_reply', 'flow', 'ai', 'api', 'broadcast', 'campaign', 'scheduled') THEN m.meta ->> 'source'
  WHEN m.sender_agent_id IS NOT NULL THEN 'ai'
  WHEN m.sender_kind = 'agent' OR m.meta ->> 'source' = 'inbox' THEN 'inbox'
  ELSE 'other' END`;

const messageType = (): SQL =>
  sql`CASE
  WHEN ${MESSAGE_SOURCE} = 'auto_reply' THEN 'auto_reply'
  WHEN ${MESSAGE_SOURCE} = 'broadcast' THEN 'broadcast'
  WHEN m.kind = 'image' THEN 'image'
  WHEN m.kind = 'video' THEN 'video'
  WHEN m.kind IN ('audio', 'voice') THEN 'audio'
  WHEN m.kind IN ('document', 'sticker') THEN 'document'
  WHEN m.kind = 'location' THEN 'location'
  WHEN m.kind = 'template' THEN 'template'
  ELSE 'text' END`;

/** The status of a recipient row, in the words of a message: anything that is not yet sent is `queued`. */
const recipientStatus = (col: string): SQL =>
  sql`CASE ${sql.raw(col)} WHEN 'sent' THEN 'sent' WHEN 'delivered' THEN 'delivered' WHEN 'read' THEN 'read' WHEN 'failed' THEN 'failed' ELSE 'queued' END`;

// --- conditions shared by the branches ---------------------------------------------------------------------------------------

const none = sql`FALSE`;

/** Filters on a branch, as conditions on the pieces of that branch. Each branch names its own columns. */
interface BranchRefs {
  entity: 'message' | 'broadcast' | 'campaign' | 'scheduled';
  /** The moment of the row (the index expression). */
  at: SQL;
  id: SQL;
  uuid: SQL;
  direction: SQL;
  status: SQL;
  source: SQL;
  kind: SQL;
  /** Names that the search term may match (contact, peer, entity), as text expressions. */
  names: SQL[];
  text: SQL | null;
  phoneDigits: SQL | null;
  phoneOpen: SQL;
  templateMatch: (templateIdSql: SQL) => SQL;
  rank: number;
}

function narrowConditions(ctx: HistoryContext, sel: HistorySelection, b: BranchRefs): SQL[] {
  const out: SQL[] = [];
  const { dir, type, source, status, q } = sel.narrow;
  if (dir === 'out') out.push(sql`${b.direction} = 'out'`);
  if (dir === 'in') out.push(sql`${b.direction} = 'in'`);
  if (dir === 'fail') out.push(sql`${b.direction} = 'out' AND ${b.status} = 'failed'`);
  if (status) out.push(sql`${b.direction} = 'out' AND ${b.status} = ${status}`);
  if (source && source.length > 0) {
    out.push(
      sql`${b.source} IN (${sql.join(
        source.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }
  if (type) {
    const p = typeFilterParts(type);
    if (p.entity) {
      // The three automated sources are their own type. A message branch can carry a broadcast (another channel's sender).
      out.push(
        b.entity === 'message'
          ? sql`${b.source} = ${p.source ?? p.entity}`
          : b.entity === p.entity
            ? sql`TRUE`
            : none,
      );
    } else if (p.source) {
      out.push(b.entity === 'message' ? sql`${b.source} = ${p.source}` : none);
    } else if (p.kinds) {
      out.push(
        b.entity === 'message'
          ? sql`${b.kind} IN (${sql.join(
              p.kinds.map((k) => sql`${k}`),
              sql`, `,
            )}) AND ${b.source} NOT IN ('auto_reply', 'broadcast')`
          : none,
      );
    }
  }
  if (q !== undefined) {
    const needle = `%${likeEscape(q)}%`;
    const alts: SQL[] = b.names.map((n) => sql`${n} ILIKE ${needle} ESCAPE '\\'`);
    if (b.text) alts.push(sql`${b.text} ILIKE ${needle} ESCAPE '\\'`);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
      alts.push(sql`${b.uuid}::text = ${q.toLowerCase()}`);
    }
    // A number is searched only where the caller may see it: otherwise typing digits would reveal them one by one.
    const digits = phoneNeedle(q);
    if (digits && b.phoneDigits) {
      alts.push(sql`(${b.phoneOpen} AND ${b.phoneDigits} LIKE ${`%${digits}%`})`);
    }
    out.push(sql`(${sql.join(alts, sql` OR `)})`);
  }
  return out;
}

function scopingConditions(ctx: HistoryContext, sel: HistorySelection, b: BranchRefs): SQL[] {
  const out: SQL[] = [];
  const s = sel.scoping;
  const org = ctx.orgId;
  if (s.channelId) {
    // Recipient rows of broadcasts, campaigns and scheduled messages name a device, not a channel: a channel filter keeps messages only.
    out.push(
      b.entity === 'message'
        ? sql`c.channel_id = (SELECT id FROM channels WHERE org_id = ${org} AND uuid = ${s.channelId}::uuid)`
        : none,
    );
  }
  if (s.templateId) {
    out.push(
      b.templateMatch(
        sql`(SELECT id FROM wa_templates WHERE org_id = ${org} AND uuid = ${s.templateId}::uuid)`,
      ),
    );
  }
  if (s.campaignId) {
    out.push(
      b.entity === 'campaign'
        ? sql`wc.campaign_id = (SELECT id FROM wpcampaigns WHERE org_id = ${org} AND uuid = ${s.campaignId}::uuid)`
        : none,
    );
  }
  if (s.broadcastId) {
    out.push(
      b.entity === 'broadcast'
        ? sql`bc.broadcast_id = (SELECT id FROM broadcasts WHERE org_id = ${org} AND uuid = ${s.broadcastId}::uuid)`
        : none,
    );
  }
  if (s.scheduledId) {
    out.push(
      b.entity === 'scheduled'
        ? sql`sc.scheduled_message_id = (SELECT id FROM scheduled_messages WHERE org_id = ${org} AND uuid = ${s.scheduledId}::uuid)`
        : none,
    );
  }
  return out;
}

/** The keyset condition for a branch of rank `r` after the cursor (order: moment, rank and id, all descending). */
function cursorCondition(b: BranchRefs, cursor: HistoryCursor | null): SQL | null {
  if (!cursor) return null;
  const at = sql`${cursor.at}::timestamptz`;
  if (b.rank < cursor.rank) return sql`${b.at} <= ${at}`;
  if (b.rank > cursor.rank) return sql`${b.at} < ${at}`;
  return sql`(${b.at} < ${at} OR (${b.at} = ${at} AND ${b.id} < ${cursor.id}))`;
}

/** The cost of a row: the newest charge made for the provider's id of the message. */
function costJoin(ctx: HistoryContext, level: Level, alias: string, providerId: SQL): SQL {
  if (!ctx.cost || !included(level, 'row')) return sql``;
  return sql`LEFT JOIN LATERAL (
      SELECT u.credits, u.currency, u.status FROM usage_charges u
      WHERE u.org_id = ${ctx.orgId} AND u.wamid = ${providerId}
      ORDER BY u.created_at DESC LIMIT 1) ${rawIdentifier(alias)} ON TRUE`;
}

const costCols = (ctx: HistoryContext, alias: string): Record<string, SQL> =>
  ctx.cost
    ? {
        cost_minor: sql`${rawIdentifier(alias)}.credits`,
        cost_currency: sql`${rawIdentifier(alias)}.currency`,
        cost_status: sql`${rawIdentifier(alias)}.status`,
      }
    : {
        cost_minor: sql`NULL::bigint`,
        cost_currency: sql`NULL::text`,
        cost_status: sql`NULL::text`,
      };

/**
 * What the feed leaves out of the message stream: a line nobody said (a call bubble, a reaction), a deleted message, and the bubble a
 * broadcast or campaign mirrored into a thread (the same send as the recipient row, which is the one shown). Used by the feed and by
 * every number that counts messages, so the cards, the charts and the table agree.
 */
const FEED_MESSAGES = (alias: string): SQL[] => {
  const m = rawIdentifier(alias);
  return [
    sql`${m}.kind NOT IN ('system', 'reaction') AND ${m}.deleted_at IS NULL`,
    sql`NOT (COALESCE(${m}.meta ->> 'source', '') = 'broadcast' AND ${m}.meta ->> 'broadcast_id' IS NOT NULL)`,
    sql`NOT (COALESCE(${m}.meta ->> 'source', '') = 'campaign' AND (${m}.meta ->> 'campaign_id' IS NOT NULL OR COALESCE(${m}.provider_message_id, '') LIKE 'campaign:%'))`,
  ];
};

// --- the four branches -------------------------------------------------------------------------------------------------------

export interface BranchOptions {
  level: Level;
  /** `n + 1` rows after this cursor, newest first; null: no limit and no order (the counts). */
  page?: { cursor: HistoryCursor | null; limit: number } | null;
  /** The window does not apply (the drawer opens one row by its id). */
  noWindow?: boolean;
  /** Only the row with this uuid. */
  only?: string | undefined;
  /** The narrowing filters do not apply (the KPI cards). */
  ignoreNarrow?: boolean;
  /** Only these branches (the drawer knows which table a row is in). */
  entities?: ReadonlyArray<'message' | 'broadcast' | 'campaign' | 'scheduled'>;
}

function finish(
  head: SQL,
  b: BranchRefs,
  where: SQL[],
  ctx: HistoryContext,
  sel: HistorySelection,
  opts: BranchOptions,
): SQL {
  const conds = [...where];
  if (!opts.noWindow) {
    conds.push(sql`${b.at} >= ${sel.window.from} AND ${b.at} < ${sel.window.to}`);
  }
  if (opts.only) conds.push(sql`${b.uuid} = ${opts.only}::uuid`);
  conds.push(...scopingConditions(ctx, sel, b));
  if (!opts.ignoreNarrow) conds.push(...narrowConditions(ctx, sel, b));
  const cur = cursorCondition(b, opts.page?.cursor ?? null);
  if (cur) conds.push(cur);
  const order = opts.page
    ? sql`ORDER BY ${b.at} DESC, ${b.id} DESC LIMIT ${opts.page.limit + 1}`
    : sql``;
  const body = sql`${head} WHERE ${sql.join(
    conds.map((c) => sql`(${c})`),
    sql` AND `,
  )} ${order}`;
  return opts.page ? sql`(${body})` : body;
}

function messageRefs(ctx: HistoryContext): BranchRefs {
  return {
    entity: 'message',
    at: sql`m.created_at`,
    id: sql`m.id`,
    uuid: sql`m.uuid`,
    direction: sql`m.direction`,
    status: sql`m.status`,
    source: MESSAGE_SOURCE,
    kind: sql`m.kind`,
    names: [contactName('ct'), sql`c.peer_name`],
    text: sql`m.body`,
    phoneDigits: sql`c.peer_key`,
    phoneOpen: contactOpen(ctx, 'ct'),
    templateMatch: (t) => sql`m.template_id = ${t}`,
    rank: RANK.message,
  };
}

function messageBranch(ctx: HistoryContext, sel: HistorySelection, o: BranchOptions): SQL {
  const org = ctx.orgId;
  const level = o.level;
  const row = included(level, 'row');
  const detail = included(level, 'detail');
  const b = messageRefs(ctx);
  const joins = sql`
    FROM messages m
    JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
    ${ctx.conversationJoins}
    LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
    ${
      row
        ? sql`LEFT JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
    LEFT JOIN wa_templates t ON t.org_id = m.org_id AND t.id = m.template_id`
        : sql``
    }
    ${detail ? sql`LEFT JOIN users su ON su.org_id = m.org_id AND su.id = m.sender_user_id` : sql``}
    ${costJoin(ctx, level, 'uc', sql`m.provider_message_id`)}`;
  const cols: Record<string, SQL> = {
    rank: sql`${RANK.message}::int`,
    id: sql`m.id`,
    at: sql`m.created_at`,
    entity_kind: sql`'message'::text`,
    source: MESSAGE_SOURCE,
    direction: sql`m.direction`,
    status: sql`m.status`,
    type: messageType(),
    provider_id: sql`m.provider_message_id`,
    uid: sql`m.uuid`,
    at_text: utcText(sql`m.created_at`),
    msg_kind: sql`m.kind`,
    conv_uuid: sql`c.uuid`,
    contact_uuid: sql`ct.uuid`,
    contact_name: sql`COALESCE(${contactName('ct')}, NULLIF(c.peer_name, ''))`,
    phone: sql`c.peer_key`,
    phone_open: contactOpen(ctx, 'ct'),
    channel_uuid: sql`ch.uuid`,
    channel_kind: sql`ch.kind`,
    channel_name: sql`ch.name`,
    body: sql`m.body`,
    media_name: sql`m.media_name`,
    template_uuid: sql`t.uuid`,
    template_name: sql`t.template_name`,
    fail_code: sql`m.failure_code`,
    fail_reason: sql`m.failure_reason`,
    entity_uuid: sql`NULL::uuid`,
    entity_name: sql`NULL::text`,
    ...costCols(ctx, 'uc'),
    created_at: sql`m.created_at`,
    sent_at: sql`m.sent_at`,
    delivered_at: sql`m.delivered_at`,
    read_at: sql`m.read_at`,
    failed_at: sql`CASE WHEN m.status = 'failed' THEN COALESCE(m.provider_ts, m.created_at) END`,
    sender_kind: sql`m.sender_kind`,
    sender_name: sql`su.full_name`,
    language: sql`m.detected_language`,
  };
  const where = [sql`m.org_id = ${org}`, ...FEED_MESSAGES('m'), ctx.conversationVisible];
  return finish(sql`SELECT ${select(level, cols)} ${joins}`, b, where, ctx, sel, o);
}

function broadcastBranch(ctx: HistoryContext, sel: HistorySelection, o: BranchOptions): SQL {
  const level = o.level;
  const row = included(level, 'row');
  const at = sql`(COALESCE(bc.sent_at, bc.created_at))`;
  const b: BranchRefs = {
    entity: 'broadcast',
    at,
    id: sql`bc.id`,
    uuid: sql`bc.uuid`,
    direction: sql`'out'`,
    status: recipientStatus('bc.status'),
    source: sql`'broadcast'`,
    kind: sql`CASE WHEN bx.template_id IS NULL THEN 'text' ELSE 'template' END`,
    names: [contactName('ct'), sql`bx.name`],
    text: null,
    phoneDigits: digitsOf(sql`ct.phone`),
    phoneOpen: contactOpen(ctx, 'ct'),
    templateMatch: (t) => sql`bx.template_id = ${t}`,
    rank: RANK.broadcast,
  };
  const joins = sql`
    FROM broadcast_contacts bc
    JOIN broadcasts bx ON bx.org_id = bc.org_id AND bx.id = bc.broadcast_id
    JOIN contacts ct ON ct.org_id = bc.org_id AND ct.id = bc.contact_id
    ${row ? sql`LEFT JOIN wa_templates t ON t.org_id = bx.org_id AND t.id = bx.template_id` : sql``}
    ${costJoin(ctx, level, 'uc', sql`bc.whatsapp_message_id`)}`;
  const cols: Record<string, SQL> = {
    rank: sql`${RANK.broadcast}::int`,
    id: sql`bc.id`,
    at,
    entity_kind: sql`'broadcast'::text`,
    source: sql`'broadcast'::text`,
    direction: sql`'out'::text`,
    status: recipientStatus('bc.status'),
    type: sql`'broadcast'::text`,
    provider_id: sql`bc.whatsapp_message_id`,
    uid: sql`bc.uuid`,
    at_text: utcText(at),
    msg_kind: b.kind,
    conv_uuid: sql`NULL::uuid`,
    contact_uuid: sql`ct.uuid`,
    contact_name: contactName('ct'),
    phone: digitsOf(sql`ct.phone`),
    phone_open: contactOpen(ctx, 'ct'),
    channel_uuid: sql`NULL::uuid`,
    channel_kind: sql`NULL::text`,
    channel_name: sql`NULL::text`,
    body: sql`NULL::text`,
    media_name: sql`NULL::text`,
    template_uuid: sql`t.uuid`,
    template_name: sql`t.template_name`,
    fail_code: sql`NULL::text`,
    fail_reason: sql`bc.error_message`,
    entity_uuid: sql`bx.uuid`,
    entity_name: sql`bx.name`,
    ...costCols(ctx, 'uc'),
    created_at: sql`bc.created_at`,
    sent_at: sql`bc.sent_at`,
    delivered_at: sql`bc.delivered_at`,
    read_at: sql`bc.read_at`,
    failed_at: sql`CASE WHEN bc.status = 'failed' THEN bc.updated_at END`,
    sender_kind: sql`'broadcast'::text`,
    sender_name: sql`NULL::text`,
    language: sql`NULL::text`,
  };
  return finish(
    sql`SELECT ${select(level, cols)} ${joins}`,
    b,
    [sql`bc.org_id = ${ctx.orgId}`],
    ctx,
    sel,
    o,
  );
}

function campaignBranch(ctx: HistoryContext, sel: HistorySelection, o: BranchOptions): SQL {
  const level = o.level;
  const row = included(level, 'row');
  const at = sql`(COALESCE(wc.sent_at, wc.created_at))`;
  const phone = digitsOf(sql`COALESCE(ct.phone, wc.phone_number)`);
  const b: BranchRefs = {
    entity: 'campaign',
    at,
    id: sql`wc.id`,
    uuid: sql`wc.uuid`,
    direction: sql`'out'`,
    status: recipientStatus('wc.status'),
    source: sql`'campaign'`,
    kind: sql`CASE WHEN k.template_id IS NULL THEN 'text' ELSE 'template' END`,
    names: [sql`wc.recipient_name`, contactName('ct'), sql`k.campaign_name`],
    text: null,
    phoneDigits: phone,
    phoneOpen: contactOpen(ctx, 'ct'),
    templateMatch: (t) =>
      sql`(k.template_id = ${t} OR k.template_id_a = ${t} OR k.template_id_b = ${t})`,
    rank: RANK.campaign,
  };
  const joins = sql`
    FROM wp_campaign_contacts wc
    JOIN wpcampaigns k ON k.org_id = wc.org_id AND k.id = wc.campaign_id
    LEFT JOIN contacts ct ON ct.org_id = wc.org_id AND ct.id = wc.contact_id
    ${row ? sql`LEFT JOIN wa_templates t ON t.org_id = k.org_id AND t.id = k.template_id` : sql``}
    ${costJoin(ctx, level, 'uc', sql`wc.whatsapp_message_id`)}`;
  const cols: Record<string, SQL> = {
    rank: sql`${RANK.campaign}::int`,
    id: sql`wc.id`,
    at,
    entity_kind: sql`'campaign'::text`,
    source: sql`'campaign'::text`,
    direction: sql`'out'::text`,
    status: recipientStatus('wc.status'),
    type: sql`'campaign'::text`,
    provider_id: sql`wc.whatsapp_message_id`,
    uid: sql`wc.uuid`,
    at_text: utcText(at),
    msg_kind: b.kind,
    conv_uuid: sql`NULL::uuid`,
    contact_uuid: sql`ct.uuid`,
    contact_name: sql`COALESCE(NULLIF(wc.recipient_name, ''), ${contactName('ct')})`,
    phone,
    phone_open: contactOpen(ctx, 'ct'),
    channel_uuid: sql`NULL::uuid`,
    channel_kind: sql`NULL::text`,
    channel_name: sql`NULL::text`,
    body: sql`NULL::text`,
    media_name: sql`NULL::text`,
    template_uuid: sql`t.uuid`,
    template_name: sql`t.template_name`,
    fail_code: sql`wc.error_code`,
    fail_reason: sql`wc.error_message`,
    entity_uuid: sql`k.uuid`,
    entity_name: sql`k.campaign_name`,
    ...costCols(ctx, 'uc'),
    created_at: sql`wc.created_at`,
    sent_at: sql`wc.sent_at`,
    delivered_at: sql`wc.delivered_at`,
    read_at: sql`wc.read_at`,
    failed_at: sql`CASE WHEN wc.status = 'failed' THEN wc.updated_at END`,
    sender_kind: sql`'broadcast'::text`,
    sender_name: sql`NULL::text`,
    language: sql`NULL::text`,
  };
  return finish(
    sql`SELECT ${select(level, cols)} ${joins}`,
    b,
    [sql`wc.org_id = ${ctx.orgId}`],
    ctx,
    sel,
    o,
  );
}

function scheduledBranch(ctx: HistoryContext, sel: HistorySelection, o: BranchOptions): SQL {
  const level = o.level;
  const row = included(level, 'row');
  const at = sql`(COALESCE(sc.sent_at, sc.created_at))`;
  const phone = digitsOf(sql`COALESCE(sc.phone, ct.phone)`);
  const b: BranchRefs = {
    entity: 'scheduled',
    at,
    id: sql`sc.id`,
    uuid: sql`sc.uuid`,
    direction: sql`'out'`,
    status: recipientStatus('sc.status'),
    source: sql`'scheduled'`,
    kind: sql`CASE WHEN sm.template_id IS NULL THEN 'text' ELSE 'template' END`,
    names: [contactName('ct'), sql`sm.schedule_name`],
    text: sql`sm.message_content`,
    phoneDigits: phone,
    phoneOpen: contactOpen(ctx, 'ct'),
    templateMatch: (t) => sql`sm.template_id = ${t}`,
    rank: RANK.scheduled,
  };
  const joins = sql`
    FROM scheduled_message_contacts sc
    JOIN scheduled_messages sm ON sm.org_id = sc.org_id AND sm.id = sc.scheduled_message_id
    LEFT JOIN contacts ct ON ct.org_id = sc.org_id AND ct.id = sc.contact_id
    ${row ? sql`LEFT JOIN wa_templates t ON t.org_id = sm.org_id AND t.id = sm.template_id` : sql``}
    ${costJoin(ctx, level, 'uc', sql`sc.wa_message_id`)}`;
  const cols: Record<string, SQL> = {
    rank: sql`${RANK.scheduled}::int`,
    id: sql`sc.id`,
    at,
    entity_kind: sql`'scheduled'::text`,
    source: sql`'scheduled'::text`,
    direction: sql`'out'::text`,
    status: recipientStatus('sc.status'),
    type: sql`'scheduled'::text`,
    provider_id: sql`sc.wa_message_id`,
    uid: sql`sc.uuid`,
    at_text: utcText(at),
    msg_kind: b.kind,
    conv_uuid: sql`NULL::uuid`,
    contact_uuid: sql`ct.uuid`,
    contact_name: contactName('ct'),
    phone,
    phone_open: contactOpen(ctx, 'ct'),
    channel_uuid: sql`NULL::uuid`,
    channel_kind: sql`NULL::text`,
    channel_name: sql`NULL::text`,
    body: sql`sm.message_content`,
    media_name: sql`NULL::text`,
    template_uuid: sql`t.uuid`,
    template_name: sql`t.template_name`,
    fail_code: sql`NULL::text`,
    fail_reason: sql`sc.error_message`,
    entity_uuid: sql`sm.uuid`,
    entity_name: sql`sm.schedule_name`,
    ...costCols(ctx, 'uc'),
    created_at: sql`sc.created_at`,
    sent_at: sql`sc.sent_at`,
    delivered_at: sql`sc.delivered_at`,
    read_at: sql`sc.read_at`,
    failed_at: sql`sc.failed_at`,
    sender_kind: sql`'system'::text`,
    sender_name: sql`NULL::text`,
    language: sql`NULL::text`,
  };
  return finish(
    sql`SELECT ${select(level, cols)} ${joins}`,
    b,
    [sql`sc.org_id = ${ctx.orgId}`],
    ctx,
    sel,
    o,
  );
}

/** The branches the caller may see and the filters can match, joined with UNION ALL. A caller who may see none of the asked branches must be answered before this is called. */
export function feedSql(ctx: HistoryContext, sel: HistorySelection, o: BranchOptions): SQL {
  const want = (e: 'message' | 'broadcast' | 'campaign' | 'scheduled') =>
    !o.entities || o.entities.includes(e);
  const branches: SQL[] = [];
  if (want('message')) branches.push(messageBranch(ctx, sel, o));
  if (ctx.bulk) {
    if (want('broadcast')) branches.push(broadcastBranch(ctx, sel, o));
    if (want('campaign')) branches.push(campaignBranch(ctx, sel, o));
    if (want('scheduled')) branches.push(scheduledBranch(ctx, sel, o));
  }
  if (branches.length === 0) throw new Error('message history: no branch is visible to the caller');
  return sql.join(o.page ? branches : branches.map((b) => sql`(${b})`), sql` UNION ALL `);
}

/** A page of the feed: `limit + 1` rows, newest first. */
export function pageSql(
  ctx: HistoryContext,
  sel: HistorySelection,
  level: Level,
  cursor: HistoryCursor | null,
  limit: number,
): SQL {
  return sql`SELECT * FROM (${feedSql(ctx, sel, { level, page: { cursor, limit } })}) f ORDER BY f.at DESC, f.rank DESC, f.id DESC LIMIT ${limit + 1}`;
}

/** The totals of the KPI cards for one window. */
export function countsSql(ctx: HistoryContext, sel: HistorySelection): SQL {
  return sql`SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE r.direction = 'in')::int AS received,
      count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'queued')::int AS queued,
      count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'sent')::int AS sent_status,
      count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'read')::int AS read,
      count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'failed')::int AS failed
    FROM (${feedSql(ctx, sel, { level: 'slim', ignoreNarrow: true })}) r`;
}

/** Charged amounts of the rows of the window, by currency. A refunded charge is not counted. */
export function costSql(ctx: HistoryContext, sel: HistorySelection): SQL {
  return sql`SELECT u.currency AS currency, sum(u.credits)::bigint AS minor, count(*)::int AS messages
    FROM (SELECT DISTINCT r.provider_id FROM (${feedSql(ctx, sel, { level: 'slim', ignoreNarrow: true })}) r
          WHERE r.direction = 'out' AND r.provider_id IS NOT NULL) p
    JOIN usage_charges u ON u.org_id = ${ctx.orgId} AND u.wamid = p.provider_id AND u.status <> 'refunded'
    GROUP BY u.currency ORDER BY u.currency NULLS FIRST`;
}

/**
 * Average seconds from a conversation's first customer message to the first reply after it, over the visible conversations of the window.
 *
 * One pass over the window's messages gives, per conversation, its first customer message and its first reply; only a conversation whose
 * first reply came BEFORE (or with) its first customer message, an agent who wrote first, needs the second look for the first reply after
 * it. The messages are aggregated before the conversation is joined, so the visibility rule runs on one row per conversation and the scan
 * of the messages stays parallel.
 */
export function firstResponseSql(ctx: HistoryContext, sel: HistorySelection): SQL {
  const channel = sel.scoping.channelId
    ? sql`AND c.channel_id = (SELECT id FROM channels WHERE org_id = ${ctx.orgId} AND uuid = ${sel.scoping.channelId}::uuid)`
    : sql``;
  const feed = (alias: string) =>
    sql.join(
      FEED_MESSAGES(alias).map((c) => sql`(${c})`),
      sql` AND `,
    );
  return sql`
    WITH per_conversation AS (
      SELECT m.conversation_id,
             min(m.created_at) FILTER (WHERE m.direction = 'in') AS at,
             min(m.created_at) FILTER (WHERE m.direction = 'out') AS first_out
      FROM messages m
      WHERE m.org_id = ${ctx.orgId} AND ${feed('m')}
        AND m.created_at >= ${sel.window.from} AND m.created_at < ${sel.window.to}
      GROUP BY m.conversation_id
      HAVING bool_or(m.direction = 'in')),
    first_in AS (
      SELECT p.conversation_id, p.at, p.first_out
      FROM per_conversation p
      JOIN conversations c ON c.org_id = ${ctx.orgId} AND c.id = p.conversation_id
      ${ctx.conversationJoins}
      WHERE (${ctx.conversationVisible}) ${channel})
    SELECT avg(EXTRACT(EPOCH FROM (o.at - f.at)))::int AS seconds
    FROM first_in f
    CROSS JOIN LATERAL (
      SELECT CASE WHEN f.first_out > f.at THEN f.first_out
        ELSE (SELECT min(m2.created_at) FROM messages m2
              WHERE m2.org_id = ${ctx.orgId} AND m2.conversation_id = f.conversation_id AND m2.direction = 'out'
                AND ${feed('m2')}
                AND m2.created_at > f.at AND m2.created_at < ${sel.window.to}) END AS at) o
    WHERE o.at IS NOT NULL`;
}

/** Messages per bucket (sent, received, failed), empty buckets included. */
export function volumeSql(
  ctx: HistoryContext,
  sel: HistorySelection,
  unit: 'hour' | 'day' | 'week',
  tz: string,
  seriesFrom: Date,
  entities?: BranchOptions['entities'],
): SQL {
  const u = sql.raw(`'${unit}'`);
  return sql`
    WITH r AS (${feedSql(ctx, { ...sel, window: { from: seriesFrom, to: sel.window.to } }, { level: 'slim', entities })}),
    agg AS (
      SELECT date_trunc(${u}, r.at AT TIME ZONE ${tz}::text) AS b,
        count(*) FILTER (WHERE r.direction = 'out' AND r.status <> 'failed')::int AS sent,
        count(*) FILTER (WHERE r.direction = 'in')::int AS received,
        count(*) FILTER (WHERE r.direction = 'out' AND r.status = 'failed')::int AS failed
      FROM r GROUP BY 1)
    SELECT to_char((gs.b AT TIME ZONE ${tz}::text) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
           COALESCE(a.sent, 0) AS sent, COALESCE(a.received, 0) AS received, COALESCE(a.failed, 0) AS failed
    FROM generate_series(
           date_trunc(${u}, ${seriesFrom}::timestamptz AT TIME ZONE ${tz}::text),
           date_trunc(${u}, (${sel.window.to}::timestamptz - interval '1 microsecond') AT TIME ZONE ${tz}::text),
           ${`1 ${unit}`}::interval) AS gs(b)
    LEFT JOIN agg a ON a.b = gs.b
    ORDER BY gs.b`;
}

/** How many rows of each type the filtered feed has, for the "By message type" card. */
export function typeMixSql(
  ctx: HistoryContext,
  sel: HistorySelection,
  entities?: BranchOptions['entities'],
): SQL {
  return sql`SELECT r.type AS type, count(*)::int AS n FROM (${feedSql(ctx, sel, { level: 'slim', entities })}) r GROUP BY r.type`;
}

/**
 * The most active conversations of the window, among the messages the caller may see. The messages are counted per conversation first and
 * only then joined to the conversation, so the sort and the visibility rule work on one row per conversation, not one per message.
 */
export function topConversationsSql(
  ctx: HistoryContext,
  sel: HistorySelection,
  limit: number,
): SQL {
  const channel = sel.scoping.channelId
    ? sql`AND c.channel_id = (SELECT id FROM channels WHERE org_id = ${ctx.orgId} AND uuid = ${sel.scoping.channelId}::uuid)`
    : sql``;
  return sql`
    SELECT c.uuid AS conversation_uuid, a.n, a.last_at,
           COALESCE(${contactName('ct')}, NULLIF(c.peer_name, '')) AS name, c.peer_key AS phone,
           ${contactOpen(ctx, 'ct')} AS phone_open
    FROM (
      SELECT m.conversation_id, count(*)::int AS n, max(m.created_at) AS last_at
      FROM messages m
      WHERE m.org_id = ${ctx.orgId} AND ${sql.join(
        FEED_MESSAGES('m').map((c) => sql`(${c})`),
        sql` AND `,
      )}
        AND m.created_at >= ${sel.window.from} AND m.created_at < ${sel.window.to}
      GROUP BY m.conversation_id) a
    JOIN conversations c ON c.org_id = ${ctx.orgId} AND c.id = a.conversation_id
    ${ctx.conversationJoins}
    LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
    WHERE (${ctx.conversationVisible}) ${channel}
    ORDER BY a.n DESC, a.last_at DESC, c.id DESC
    LIMIT ${limit}`;
}

// --- one scan for the charts ----------------------------------------------------------------------------------------------------
//
// The charts (volume, type mix, most active conversations) each read the window's messages: three scans of 750,000 rows for a busy month,
// each paying for the visibility join, the feed filter and the CASE on `meta`. `insightsScanSql` reads the message branch ONCE and
// aggregates the three ways at the same time (GROUPING SETS): 760 ms to 400 ms, provided the sort fits in memory (see the repository's
// work_mem note; at the default 4 MB it spills and is slower, 944 ms). The KPI cards were tried the same way and are SLOWER (467 ms for
// the counts pass alone against 314 ms for the two count statements), because GROUPING SETS cannot run in parallel workers and a per-conversation
// pass pays for ten aggregates per row; they keep one statement per number. The recipient rows of broadcasts, campaigns and scheduled messages stay on their own branches and are
// added by the caller. The fast path is only valid when the filters are the channel alone: a template, campaign, broadcast or scheduled
// filter changes which rows the volume and the type mix count but not the top list, and the old statements keep that difference.

/** Whether the shared scan gives the same numbers as the separate statements for this selection. */
export function sharedScanApplies(sel: HistorySelection): boolean {
  const s = sel.scoping;
  return !s.templateId && !s.campaignId && !s.broadcastId && !s.scheduledId;
}

/** The recipient branches (no conversation): what the caller adds to the shared scan's message numbers. */
export const BULK_ENTITIES = ['broadcast', 'campaign', 'scheduled'] as const;

interface ScanOptions {
  from: Date;
  to: Date;
  /** Also compute the message type of each row (a CASE over `meta`: only when the type mix is asked for). */
  wantType?: boolean;
  /** Also compute whether each row passes the screen's narrowing filters (direction, type, source, status, search). */
  wantNarrow?: boolean;
}

/** The message branch of the feed for [from, to), one slim row per message, with the filters as columns instead of as a WHERE. */
function messageScanSql(ctx: HistoryContext, sel: HistorySelection, o: ScanOptions): SQL {
  const b = messageRefs(ctx);
  const conds = [
    sql`m.org_id = ${ctx.orgId}`,
    ...FEED_MESSAGES('m'),
    ctx.conversationVisible,
    sql`m.created_at >= ${o.from} AND m.created_at < ${o.to}`,
    ...scopingConditions(ctx, sel, b),
  ];
  const narrow = o.wantNarrow ? narrowConditions(ctx, sel, b) : [];
  const narrowOk = narrow.length
    ? sql.join(
        narrow.map((c) => sql`(${c})`),
        sql` AND `,
      )
    : sql`TRUE`;
  return sql`
    SELECT m.created_at AS at, m.direction AS direction, m.status AS status, m.conversation_id AS conv,
           ${o.wantType ? sql`${messageType()}` : sql`NULL::text`} AS type, (${narrowOk}) AS narrow_ok
    FROM messages m
    JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
    ${ctx.conversationJoins}
    LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id
    WHERE ${sql.join(
      conds.map((c) => sql`(${c})`),
      sql` AND `,
    )}`;
}

/**
 * The message branch's numbers for the charts, from one scan of the window: the volume per bucket (every bucket of the series, empty ones
 * included), the type mix and the most active conversations. Rows: kind 'v' (a bucket: k = its time, a/b/c = sent/received/failed), 'm' (a
 * type: k = the type, a = its count) and 'c' (a conversation: k = its uuid, a = messages, ts = last message, name, phone, open; `ord` = its id
 * for the tie-break).
 */
export function insightsScanSql(
  ctx: HistoryContext,
  sel: HistorySelection,
  o: { unit: 'hour' | 'day' | 'week'; tz: string; seriesFrom: Date; top: number },
): SQL {
  const u = sql.raw(`'${o.unit}'`);
  const { from, to } = sel.window;
  return sql`
    WITH g AS (
      SELECT GROUPING(x.b, x.t, x.conv) AS g, x.b, x.t, x.conv,
        count(*) FILTER (WHERE x.direction = 'out' AND x.status <> 'failed')::int AS sent,
        count(*) FILTER (WHERE x.direction = 'in')::int AS received,
        count(*) FILTER (WHERE x.direction = 'out' AND x.status = 'failed')::int AS failed,
        count(*)::int AS n, max(x.at) AS last_at
      FROM (
        SELECT s.at, s.direction, s.status, s.conv,
          CASE WHEN s.narrow_ok AND s.at >= ${o.seriesFrom} THEN date_trunc(${u}, s.at AT TIME ZONE ${o.tz}::text) END AS b,
          CASE WHEN s.narrow_ok THEN s.type END AS t
        FROM (${messageScanSql(ctx, sel, { from, to, wantType: true, wantNarrow: true })}) s) x
      GROUP BY GROUPING SETS ((x.b), (x.t), (x.conv)))
    SELECT 'v' AS kind,
           to_char((gs.b AT TIME ZONE ${o.tz}::text) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS k,
           COALESCE(a.sent, 0)::bigint AS a, COALESCE(a.received, 0)::bigint AS b, COALESCE(a.failed, 0)::bigint AS c,
           NULL::timestamptz AS ts, NULL::text AS name, NULL::text AS phone, NULL::boolean AS open,
           row_number() OVER (ORDER BY gs.b) AS ord
    FROM generate_series(
           date_trunc(${u}, ${o.seriesFrom}::timestamptz AT TIME ZONE ${o.tz}::text),
           date_trunc(${u}, (${to}::timestamptz - interval '1 microsecond') AT TIME ZONE ${o.tz}::text),
           ${`1 ${o.unit}`}::interval) AS gs(b)
    LEFT JOIN (SELECT b, sent, received, failed FROM g WHERE g = 3 AND b IS NOT NULL) a ON a.b = gs.b
    UNION ALL
    SELECT 'm', g.t, g.n, 0, 0, NULL, NULL, NULL, NULL, 0 FROM g WHERE g.g = 5 AND g.t IS NOT NULL
    UNION ALL
    SELECT 'c', c.uuid::text, a.n, 0, 0, a.last_at,
           COALESCE(${contactName('ct')}, NULLIF(c.peer_name, '')), c.peer_key, ${contactOpen(ctx, 'ct')}, a.conv
    FROM (SELECT conv, n, last_at FROM g WHERE g = 6 ORDER BY n DESC, last_at DESC, conv DESC LIMIT ${o.top}) a
    JOIN conversations c ON c.org_id = ${ctx.orgId} AND c.id = a.conv
    LEFT JOIN contacts ct ON ct.org_id = c.org_id AND ct.id = c.contact_id`;
}
