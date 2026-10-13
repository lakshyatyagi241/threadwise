import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface InboxTagRow {
  id: number;
  uuid: string;
  name: string;
  color: string | null;
  description: string | null;
  conversationCount: number;
  rowVersion: number;
}

const SELECT = sql`
  SELECT t.id, t.uuid, t.name::text AS name, t.color, t.description, t.row_version,
         (SELECT count(*)::int FROM conversation_tag x WHERE x.org_id = t.org_id AND x.tag_id = t.id) AS conversation_count
  FROM tags t`;

const toRow = (r: Raw): InboxTagRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  color: (r.color as string | null) ?? null,
  description: (r.description as string | null) ?? null,
  conversationCount: Number(r.conversation_count ?? 0),
  rowVersion: Number(r.row_version),
});

/**
 * The workspace tag library as the inbox reads it (the `tags` table, shared with contacts) and the tags on conversations
 * (`conversation_tag`). Creating and deleting a tag go through the contacts domain's `TagsService` (plan limit, uniqueness, audit);
 * what is here is the inbox's own: the list with usage counts, the description, the edit with a version check, and the attach table.
 */
@Injectable()
export class InboxTagsRepository {
  async list(tx: Tx, orgId: number): Promise<InboxTagRow[]> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} ORDER BY t.name`);
    return (res.rows as Raw[]).map(toRow);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<InboxTagRow | null> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<InboxTagRow | null> {
    const res = await tx.execute(sql`${SELECT} WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : null;
  }

  async setDescription(tx: Tx, orgId: number, id: number, description: string): Promise<void> {
    await tx.execute(
      sql`UPDATE tags SET description = ${description} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Edit with the version the caller read; false when the version moved. A taken name raises the unique violation (23505). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    patch: { name?: string; color?: string | null; description?: string | null },
  ): Promise<boolean> {
    const sets = [
      patch.name !== undefined ? sql`name = ${patch.name}` : null,
      patch.color !== undefined ? sql`color = ${patch.color}` : null,
      patch.description !== undefined ? sql`description = ${patch.description}` : null,
    ].filter((s): s is NonNullable<typeof s> => s !== null);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE tags SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** True when the tag was put on the thread now, false when it was already there. */
  async attach(
    tx: Tx,
    orgId: number,
    conversationId: number,
    tagId: number,
    addedBy: number | null,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO conversation_tag (org_id, conversation_id, tag_id, added_by)
      VALUES (${orgId}, ${conversationId}, ${tagId}, ${addedBy})
      ON CONFLICT (org_id, conversation_id, tag_id) DO NOTHING
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** True when the tag was on the thread and is gone now. */
  async detach(tx: Tx, orgId: number, conversationId: number, tagId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM conversation_tag
      WHERE org_id = ${orgId} AND conversation_id = ${conversationId} AND tag_id = ${tagId}
      RETURNING id`);
    return res.rows.length > 0;
  }

  /** Moves the conversation's `row_version` (the touch trigger), so a client holding the old row sees that it changed. */
  async touchConversation(tx: Tx, orgId: number, conversationId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE conversations SET updated_at = now() WHERE org_id = ${orgId} AND id = ${conversationId}`,
    );
  }
}
