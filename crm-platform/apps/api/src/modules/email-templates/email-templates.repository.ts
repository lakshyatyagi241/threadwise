import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EmailTemplatePurpose, ListEmailTemplatesQuery } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';

type Raw = Record<string, unknown>;
const rowsOf = (res: unknown): Raw[] => (res as { rows: Raw[] }).rows;

export type EmailTemplateRow = Raw;

/** Escapes `\`, `%` and `_` so a search for `50%` looks for 50 followed by a percent sign. */
const like = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

const encode = (createdAtIso: string, id: number) =>
  Buffer.from(`${createdAtIso}|${id}`, 'utf8').toString('base64url');
function decode(cursor: string): { createdAtIso: string; id: number } {
  const [iso, i] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const id = Number.parseInt(i ?? '', 10);
  if (!iso || Number.isNaN(id) || Number.isNaN(new Date(iso).getTime())) {
    throw AppError.validation('Invalid pagination cursor');
  }
  return { createdAtIso: iso, id };
}

const COLUMNS = sql`
  t.id, t.uuid, t.user_id, t.name, t.subject, t.body_html, t.body_text, t.category, t.purpose, t.status, t.used_count,
  t.last_used_at, t.created_by, cu.full_name AS created_by_name, t.row_version, t.created_at, t.updated_at,
  to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`;
const FROM = sql`
  FROM email_templates t
  LEFT JOIN users cu ON cu.org_id = t.org_id AND cu.id = t.created_by`;

/** The caller sees every shared template and their own personal ones; a colleague's personal template does not exist for them. */
const visible = (me: number) => sql`(t.user_id IS NULL OR t.user_id = ${me})`;

export interface TemplateWrite {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  category: string | null;
  purpose: EmailTemplatePurpose;
}

/** Every `email_templates` query. Each takes the caller's tenant transaction. */
@Injectable()
export class EmailTemplatesRepository {
  async list(
    tx: Tx,
    orgId: number,
    me: number,
    q: ListEmailTemplatesQuery,
  ): Promise<{ rows: EmailTemplateRow[]; nextCursor: string | null }> {
    const cur = q.cursor ? decode(q.cursor) : null;
    const text = q.q ? like(q.q) : null;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
      WHERE t.org_id = ${orgId} AND ${visible(me)}
        ${q.scope === 'shared' ? sql`AND t.user_id IS NULL` : sql``}
        ${q.scope === 'mine' ? sql`AND t.user_id = ${me}` : sql``}
        ${q.status !== 'all' ? sql`AND t.status = ${q.status}` : sql``}
        ${q.purpose ? sql`AND t.purpose = ${q.purpose}` : sql``}
        ${q.category ? sql`AND t.category = ${q.category}` : sql``}
        ${text ? sql`AND (t.name ILIKE ${text} OR t.subject ILIKE ${text} OR t.category ILIKE ${text})` : sql``}
        ${
          cur
            ? sql`AND (t.created_at, t.id) < (${cur.createdAtIso}::timestamptz, ${cur.id})`
            : sql``
        }
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${q.limit + 1}`);
    const rows = rowsOf(res);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor:
        rows.length > q.limit && last
          ? encode(last.created_at_iso as string, Number(last.id))
          : null,
    };
  }

  async categories(tx: Tx, orgId: number, me: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT DISTINCT t.category FROM email_templates t
      WHERE t.org_id = ${orgId} AND ${visible(me)} AND t.category IS NOT NULL ORDER BY t.category`);
    return rowsOf(res).map((r) => r.category as string);
  }

  async byUuid(
    tx: Tx,
    orgId: number,
    me: number,
    uuid: string,
    forUpdate = false,
  ): Promise<EmailTemplateRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} ${FROM}
      WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid AND ${visible(me)}
      ${forUpdate ? sql`FOR UPDATE OF t` : sql``}`);
    return rowsOf(res)[0];
  }

  async nameTaken(
    tx: Tx,
    orgId: number,
    ownerId: number | null,
    name: string,
    exceptId?: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM email_templates t
      WHERE t.org_id = ${orgId} AND lower(t.name) = lower(${name})
        AND ${ownerId === null ? sql`t.user_id IS NULL` : sql`t.user_id = ${ownerId}`}
        ${exceptId !== undefined ? sql`AND t.id <> ${exceptId}` : sql``}
      LIMIT 1`);
    return rowsOf(res).length > 0;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: TemplateWrite & { ownerId: number | null; createdBy: number },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO email_templates (org_id, user_id, name, subject, body_html, body_text, category, purpose, created_by)
      VALUES (${orgId}, ${v.ownerId}, ${v.name}, ${v.subject}, ${v.bodyHtml}, ${v.bodyText}, ${v.category}, ${v.purpose}, ${v.createdBy})
      RETURNING id, uuid`);
    const r = rowsOf(res)[0]!;
    return { id: Number(r.id), uuid: r.uuid as string };
  }

  /** The columns given; false when the row version moved since the caller read it. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    patch: Partial<TemplateWrite> & { status?: 'active' | 'archived' },
  ): Promise<boolean> {
    const sets = [
      patch.name !== undefined ? sql`name = ${patch.name}` : null,
      patch.subject !== undefined ? sql`subject = ${patch.subject}` : null,
      patch.bodyHtml !== undefined ? sql`body_html = ${patch.bodyHtml}` : null,
      patch.bodyText !== undefined ? sql`body_text = ${patch.bodyText}` : null,
      patch.category !== undefined ? sql`category = ${patch.category}` : null,
      patch.purpose !== undefined ? sql`purpose = ${patch.purpose}` : null,
      patch.status !== undefined ? sql`status = ${patch.status}` : null,
    ].filter((s) => s !== null);
    if (sets.length === 0) return true;
    const res = await tx.execute(sql`
      UPDATE email_templates SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return rowsOf(res).length === 1;
  }

  async remove(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM email_templates WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Counts one sent use. The database trigger leaves the row version alone, so an open edit dialog still saves. */
  async bumpUsage(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE email_templates SET used_count = used_count + 1, last_used_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The facts a send needs, by public id, for the one who sends: absent when it does not exist or is a colleague's personal one. */
  async forSend(
    tx: Tx,
    orgId: number,
    me: number,
    uuid: string,
  ): Promise<{ id: number; purpose: EmailTemplatePurpose; status: string } | undefined> {
    const res = await tx.execute(sql`
      SELECT t.id, t.purpose, t.status FROM email_templates t
      WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid AND ${visible(me)}`);
    const r = rowsOf(res)[0];
    return r
      ? { id: Number(r.id), purpose: r.purpose as EmailTemplatePurpose, status: r.status as string }
      : undefined;
  }

  async agentName(tx: Tx, orgId: number, userId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT full_name FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    return (rowsOf(res)[0]?.full_name as string | undefined) ?? null;
  }
}
