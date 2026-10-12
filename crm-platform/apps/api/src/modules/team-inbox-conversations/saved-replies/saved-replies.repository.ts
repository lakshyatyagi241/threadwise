import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListSavedRepliesQuery } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';

type Raw = Record<string, unknown>;
const rowsOf = (res: unknown): Raw[] => (res as { rows: Raw[] }).rows;

export type SavedReplyRow = Raw;

/** Escapes `\`, `%` and `_` so a search for `50%` looks for 50 followed by a percent sign. */
const like = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** A Postgres `text[]` literal from bound values (an empty list is `'{}'`). */
const textArray = (values: readonly string[]): SQL =>
  values.length === 0
    ? sql`'{}'::text[]`
    : sql`ARRAY[${sql.join(
        values.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`;

const encode = (usedCount: number, id: number) =>
  Buffer.from(`${usedCount}|${id}`, 'utf8').toString('base64url');
function decode(cursor: string): { usedCount: number; id: number } {
  const [u, i] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const usedCount = Number.parseInt(u ?? '', 10);
  const id = Number.parseInt(i ?? '', 10);
  if (Number.isNaN(usedCount) || Number.isNaN(id))
    throw AppError.validation('Invalid pagination cursor');
  return { usedCount, id };
}

const COLUMNS = sql`
  r.id, r.uuid, r.user_id, r.shortcut, r.title, r.body, r.category, r.language, r.channel_kinds, r.used_count,
  r.last_used_at, r.created_by, cu.full_name AS created_by_name, r.row_version, r.created_at, r.updated_at`;
const FROM = sql`
  FROM saved_replies r
  LEFT JOIN users cu ON cu.org_id = r.org_id AND cu.id = r.created_by`;

/** The caller sees every shared reply and their own personal ones (Reference's `accessibleBy`). */
const visible = (me: number): SQL => sql`(r.user_id IS NULL OR r.user_id = ${me})`;

/** Every `saved_replies` query. Each takes the caller's tenant transaction. */
@Injectable()
export class SavedRepliesRepository {
  async list(
    tx: Tx,
    orgId: number,
    me: number,
    q: ListSavedRepliesQuery,
  ): Promise<{ rows: SavedReplyRow[]; nextCursor: string | null }> {
    const cur = q.cursor ? decode(q.cursor) : null;
    const text = q.q ? like(q.q.replace(/^\/+/, '') || q.q) : null;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
      WHERE r.org_id = ${orgId} AND ${visible(me)}
        ${q.scope === 'shared' ? sql`AND r.user_id IS NULL` : sql``}
        ${q.scope === 'mine' ? sql`AND r.user_id = ${me}` : sql``}
        ${q.channelKind ? sql`AND (cardinality(r.channel_kinds) = 0 OR ${q.channelKind} = ANY (r.channel_kinds))` : sql``}
        ${q.category ? sql`AND lower(r.category) = lower(${q.category})` : sql``}
        ${text ? sql`AND (r.shortcut ILIKE ${text} OR r.title ILIKE ${text} OR r.body ILIKE ${text})` : sql``}
        ${cur ? sql`AND (r.used_count < ${cur.usedCount} OR (r.used_count = ${cur.usedCount} AND r.id > ${cur.id}))` : sql``}
      ORDER BY r.used_count DESC, r.id
      LIMIT ${q.limit + 1}`);
    const rows = rowsOf(res);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > q.limit && last ? encode(Number(last.used_count), Number(last.id)) : null,
    };
  }

  /** The tab counts, the category filter and the plan's total, in two reads. */
  async summary(
    tx: Tx,
    orgId: number,
    me: number,
  ): Promise<{ shared: number; mine: number; total: number; categories: string[] }> {
    const counts = rowsOf(
      await tx.execute(sql`
        SELECT count(*) FILTER (WHERE user_id IS NULL)::int AS shared,
               count(*) FILTER (WHERE user_id = ${me})::int AS mine,
               count(*)::int AS total
        FROM saved_replies WHERE org_id = ${orgId}`),
    )[0]!;
    const cats = rowsOf(
      await tx.execute(sql`
        SELECT min(category) AS category FROM saved_replies r
        WHERE r.org_id = ${orgId} AND ${visible(me)} AND category IS NOT NULL
        GROUP BY lower(category) ORDER BY lower(min(category))`),
    );
    return {
      shared: Number(counts.shared),
      mine: Number(counts.mine),
      total: Number(counts.total),
      categories: cats.map((c) => c.category as string),
    };
  }

  /** One reply the caller may see (a colleague's personal reply is simply absent). `lock` takes the row for an update or delete. */
  async byUuid(
    tx: Tx,
    orgId: number,
    me: number,
    uuid: string,
    lock = false,
  ): Promise<SavedReplyRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
      WHERE r.org_id = ${orgId} AND r.uuid = ${uuid}::uuid AND ${visible(me)}
      ${lock ? sql`FOR UPDATE OF r` : sql``}`);
    return rowsOf(res)[0] ?? null;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      ownerId: number | null;
      createdBy: number;
      shortcut: string;
      title: string;
      body: string;
      category: string | null;
      language: string | null;
      channelKinds: readonly string[];
    },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO saved_replies (org_id, user_id, created_by, shortcut, title, body, category, language, channel_kinds)
      VALUES (${orgId}, ${v.ownerId}, ${v.createdBy}, ${v.shortcut}, ${v.title}, ${v.body}, ${v.category}, ${v.language},
              ${textArray(v.channelKinds)})
      RETURNING id, uuid`);
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  /** Writes the fields given, only if the row is still at `rowVersion`. False when it moved (the caller answers 409). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: {
      shortcut?: string;
      title?: string;
      body?: string;
      category?: string | null;
      language?: string | null;
      channelKinds?: readonly string[];
    },
  ): Promise<boolean> {
    const set: SQL[] = [];
    if (v.shortcut !== undefined) set.push(sql`shortcut = ${v.shortcut}`);
    if (v.title !== undefined) set.push(sql`title = ${v.title}`);
    if (v.body !== undefined) set.push(sql`body = ${v.body}`);
    if (v.category !== undefined) set.push(sql`category = ${v.category}`);
    if (v.language !== undefined) set.push(sql`language = ${v.language}`);
    if (v.channelKinds !== undefined) {
      set.push(sql`channel_kinds = ${textArray(v.channelKinds)}`);
    }
    if (set.length === 0) set.push(sql`title = title`);
    const res = await tx.execute(sql`
      UPDATE saved_replies SET ${sql.join(set, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return rowsOf(res).length > 0;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM saved_replies WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Counts one insert into a composer. Atomic, and it does not move `row_version` (an edit dialog stays valid while the reply is used). */
  async bumpUsage(tx: Tx, orgId: number, id: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE saved_replies SET used_count = used_count + 1, last_used_at = now()
      WHERE org_id = ${orgId} AND id = ${id} RETURNING used_count`);
    return Number(rowsOf(res)[0]!.used_count);
  }

  /** Whether the owner already uses this shortcut (a shared reply's owner is NULL), ignoring `exceptId`. */
  async shortcutTaken(
    tx: Tx,
    orgId: number,
    ownerId: number | null,
    shortcut: string,
    exceptId?: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM saved_replies
      WHERE org_id = ${orgId} AND user_id IS NOT DISTINCT FROM ${ownerId}::bigint AND shortcut = ${shortcut}
        ${exceptId !== undefined ? sql`AND id <> ${exceptId}` : sql``}
      LIMIT 1`);
    return rowsOf(res).length > 0;
  }

  /** The first shortcut of the form `base`, `base_2`, `base_3`... this owner does not use (for a duplicate). */
  async freeShortcut(tx: Tx, orgId: number, ownerId: number | null, base: string): Promise<string> {
    for (let n = 1; n < 1000; n += 1) {
      const suffix = n === 1 ? '' : `_${n}`;
      const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (!(await this.shortcutTaken(tx, orgId, ownerId, candidate))) return candidate;
    }
    throw AppError.validation('No free shortcut for this reply');
  }

  // --- what a use reads -------------------------------------------------------------------------------------------------------

  async agentName(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (rowsOf(res)[0]?.full_name as string | undefined) ?? null;
  }

  /** The channel's name and its public address (the number of a WhatsApp line): Reference's device label and phone. */
  async channelFacts(
    tx: Tx,
    orgId: number,
    channelId: number,
  ): Promise<{ name: string | null; address: string | null }> {
    const res = await tx.execute(
      sql`SELECT name, display_address FROM channels WHERE org_id = ${orgId} AND id = ${channelId}`,
    );
    const r = rowsOf(res)[0];
    return {
      name: (r?.name as string | undefined) ?? null,
      address: (r?.display_address as string | undefined) ?? null,
    };
  }
}
