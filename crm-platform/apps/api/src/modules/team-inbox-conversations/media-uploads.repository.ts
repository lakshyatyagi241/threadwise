import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { InboxMediaKind } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;

export interface MediaUploadRow {
  id: number;
  uuid: string;
  mediaKey: string;
  kind: InboxMediaKind;
  mime: string;
  sizeBytes: number;
  name: string;
  sha256: string;
  expiresAt: Date;
  /** Set when a send has claimed the file (the sender's `clientMessageId`). */
  claimedBy: string | null;
}

const toRow = (r: Raw): MediaUploadRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  mediaKey: r.media_key as string,
  kind: r.kind as InboxMediaKind,
  mime: r.mime as string,
  sizeBytes: Number(r.size_bytes),
  name: r.name as string,
  sha256: r.sha256 as string,
  expiresAt: new Date(r.expires_at as string),
  claimedBy: (r.used_by_client_message_id as string | null) ?? null,
});

/** References to files an agent attached before sending. The bytes are in the media store; this is who may use them and until when. */
@Injectable()
export class MediaUploadsRepository {
  async insert(
    tx: Tx,
    orgId: number,
    userId: number,
    file: {
      key: string;
      kind: InboxMediaKind;
      mime: string;
      size: number;
      name: string;
      sha256: string;
    },
    ttlHours: number,
  ): Promise<MediaUploadRow> {
    const res = await tx.execute(sql`
      INSERT INTO conversation_media_uploads (org_id, user_id, media_key, kind, mime, size_bytes, name, sha256, expires_at)
      VALUES (${orgId}, ${userId}, ${file.key}, ${file.kind}, ${file.mime}, ${file.size}, ${file.name}, ${file.sha256},
              now() + make_interval(hours => ${ttlHours}))
      RETURNING *`);
    return toRow(res.rows[0] as Raw);
  }

  /**
   * Claims the uploader's own, unexpired, unclaimed file for the send named by `clientMessageId`. A file this same send already claimed
   * is returned again (a retry of that send), so the retry reaches the first message. Anything else (another agent's file, another
   * workspace's, an expired or already used one) is null.
   *
   * `fresh` tells the caller whether this call made the claim, so a send that is refused afterwards can release exactly that.
   */
  async claim(
    tx: Tx,
    orgId: number,
    userId: number,
    uuid: string,
    clientMessageId: string,
  ): Promise<{ row: MediaUploadRow; fresh: boolean } | null> {
    const res = await tx.execute(sql`
      SELECT * FROM conversation_media_uploads
      WHERE org_id = ${orgId} AND uuid = ${uuid} AND user_id = ${userId} FOR UPDATE`);
    const found = res.rows[0] as Raw | undefined;
    if (!found) return null;
    const row = toRow(found);
    if (row.claimedBy === clientMessageId) return { row, fresh: false };
    if (row.claimedBy !== null || row.expiresAt.getTime() <= Date.now()) return null;
    await tx.execute(sql`
      UPDATE conversation_media_uploads SET used_at = now(), used_by_client_message_id = ${clientMessageId}::uuid
      WHERE org_id = ${orgId} AND id = ${row.id}`);
    return { row: { ...row, claimedBy: clientMessageId }, fresh: true };
  }

  /** Gives a claim back after the send it was for was refused. */
  async release(tx: Tx, orgId: number, id: number, clientMessageId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE conversation_media_uploads SET used_at = NULL, used_by_client_message_id = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND used_by_client_message_id = ${clientMessageId}::uuid`);
  }
}
