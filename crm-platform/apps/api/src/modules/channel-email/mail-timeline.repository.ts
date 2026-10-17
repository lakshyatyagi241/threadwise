import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const rows = (res: unknown): Raw[] => (res as { rows: Raw[] }).rows;

/**
 * Data access of the Email channel's timeline ledger (`mail_timeline_entries`, E-19) and the two reads it needs from the inbox to know
 * whose timeline a mail belongs on. The `contact_activities` row itself is written through the CRM's own repository.
 */
@Injectable()
export class MailTimelineRepository {
  /**
   * Serialises two writers of the same mail (a retried send overlapping its first try, a sync overlapping a manual one) for the rest of the
   * transaction, so "is it written?" and "write it" cannot interleave. Released at commit.
   */
  async lock(tx: Tx, orgId: number, dedupeKey: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`mail-timeline:${orgId}:${dedupeKey}`}, 0))`,
    );
  }

  async exists(tx: Tx, orgId: number, dedupeKey: string): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM mail_timeline_entries WHERE org_id = ${orgId} AND dedupe_key = ${dedupeKey}`,
    );
    return rows(res).length > 0;
  }

  async link(tx: Tx, orgId: number, dedupeKey: string, activityId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO mail_timeline_entries (org_id, dedupe_key, activity_id)
      VALUES (${orgId}, ${dedupeKey}, ${activityId})
      ON CONFLICT (org_id, dedupe_key) DO NOTHING`);
  }

  /** The contact an email conversation is linked to, or null (a thread nobody is linked to yet, or no such conversation). */
  async contactOfConversation(
    tx: Tx,
    orgId: number,
    conversationUuid: string,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${conversationUuid}::uuid`);
    const id = rows(res)[0]?.contact_id;
    return id === null || id === undefined ? null : Number(id);
  }

  /** The contact of the thread `peerKey` on a channel (a reply is written before anything names its conversation). */
  async contactOfThread(
    tx: Tx,
    orgId: number,
    channelUuid: string,
    peerKey: string,
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      SELECT c.contact_id FROM conversations c
        JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
       WHERE c.org_id = ${orgId} AND ch.uuid = ${channelUuid}::uuid AND c.peer_key = ${peerKey}`);
    const id = rows(res)[0]?.contact_id;
    return id === null || id === undefined ? null : Number(id);
  }
}
