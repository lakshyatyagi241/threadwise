import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface StagedAttachmentRow {
  id: number;
  uuid: string;
  uploadedBy: number | null;
  name: string;
  mime: string;
  size: number;
  objectKey: string;
  usedAt: Date | null;
  expiresAt: Date;
}

const toRow = (r: Raw): StagedAttachmentRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  uploadedBy: r.uploaded_by === null ? null : Number(r.uploaded_by),
  name: r.name as string,
  mime: r.mime as string,
  size: Number(r.size),
  objectKey: r.object_key as string,
  usedAt: r.used_at ? new Date(r.used_at as string) : null,
  expiresAt: new Date(r.expires_at as string),
});

const rows = (res: { rows: unknown[] }) => res.rows as Raw[];

/** `mail_outbound_attachments`: files staged by the composer, each owned by its uploader until it is sent once or expires. */
@Injectable()
export class MailOutboundAttachmentsRepository {
  async insert(
    tx: Tx,
    orgId: number,
    f: {
      uploadedBy: number;
      conversationId: number | null;
      name: string;
      mime: string;
      size: number;
      objectKey: string;
      ttlHours: number;
    },
  ): Promise<StagedAttachmentRow> {
    const res = await tx.execute(sql`
      INSERT INTO mail_outbound_attachments (org_id, uploaded_by, conversation_id, name, mime, size, object_key, expires_at)
      VALUES (${orgId}, ${f.uploadedBy}, ${f.conversationId}, ${f.name}, ${f.mime}, ${f.size}, ${f.objectKey},
              now() + make_interval(hours => ${f.ttlHours}))
      RETURNING *`);
    return toRow(rows(res)[0]!);
  }

  /** The uploader's own, unsent file (what a delete may touch). */
  async ownedUnused(
    tx: Tx,
    orgId: number,
    uuid: string,
    userId: number,
  ): Promise<StagedAttachmentRow | undefined> {
    const res = await tx.execute(sql`
      SELECT * FROM mail_outbound_attachments
       WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND uploaded_by = ${userId} AND used_at IS NULL FOR UPDATE`);
    const r = rows(res)[0];
    return r ? toRow(r) : undefined;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM mail_outbound_attachments WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /**
   * The files a reply names, only when they are the sender's own. A first attempt takes only unsent, unexpired files; a retry (attempt
   * above 1) also takes files an earlier try already sent or that expired meanwhile, so a lost answer never strands the message.
   */
  async forSend(
    tx: Tx,
    orgId: number,
    userId: number,
    uuids: string[],
    retry: boolean,
  ): Promise<StagedAttachmentRow[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT * FROM mail_outbound_attachments
       WHERE org_id = ${orgId} AND uploaded_by = ${userId}
         AND uuid = ANY(ARRAY[${sql.join(
           uuids.map((u) => sql`${u}::uuid`),
           sql`, `,
         )}])
         ${retry ? sql`` : sql`AND used_at IS NULL AND expires_at > now()`}`);
    return rows(res).map(toRow);
  }

  async markUsed(tx: Tx, orgId: number, uuids: string[]): Promise<void> {
    if (uuids.length === 0) return;
    await tx.execute(sql`
      UPDATE mail_outbound_attachments SET used_at = coalesce(used_at, now())
       WHERE org_id = ${orgId}
         AND uuid = ANY(ARRAY[${sql.join(
           uuids.map((u) => sql`${u}::uuid`),
           sql`, `,
         )}])`);
  }

  /** The internal id of a conversation of this workspace by its uuid. */
  async conversationId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM conversations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const id = rows(res)[0]?.id;
    return id === undefined ? undefined : Number(id);
  }

  /** Cross-workspace (run privileged): unsent files that expired more than `graceMinutes` ago. */
  async expiredEverywhere(
    tx: Tx,
    graceMinutes: number,
    limit: number,
  ): Promise<Array<{ id: number; orgId: number; objectKey: string }>> {
    const res = await tx.execute(sql`
      SELECT id, org_id, object_key FROM mail_outbound_attachments
       WHERE used_at IS NULL AND expires_at < now() - make_interval(mins => ${graceMinutes})
       ORDER BY expires_at LIMIT ${limit}`);
    return rows(res).map((r) => ({
      id: Number(r.id),
      orgId: Number(r.org_id),
      objectKey: r.object_key as string,
    }));
  }

  async deleteUnusedById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      DELETE FROM mail_outbound_attachments WHERE org_id = ${orgId} AND id = ${id} AND used_at IS NULL RETURNING id`);
    return rows(res).length > 0;
  }
}
