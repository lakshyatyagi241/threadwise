import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../../../common/context/request-context';
import { DatabaseService } from '../../../../infra/db/database.service';

export interface ScheduledExtras {
  templateId: string | null;
  senderKey: string | null;
  createdAt: Date;
}

/**
 * The three public fields the staff schedule read does not carry: the template and sender as uuids and the creation time (TW-API-091 to 094).
 * A read of `scheduled_messages` joined to the template and sender tables for exactly those, the way the broadcast and campaign reads
 * resolve a sender key, until the scheduled domain's own read exposes them. One statement per page, always scoped to the workspace.
 */
@Injectable()
export class ScheduledExtrasRepository {
  constructor(private readonly db: DatabaseService) {}

  async byUuid(uuids: readonly string[]): Promise<Map<string, ScheduledExtras>> {
    const out = new Map<string, ScheduledExtras>();
    if (uuids.length === 0) return out;
    const { orgId } = RequestContextStore.require();
    const ids = sql.join(
      uuids.map((u) => sql`${u}::uuid`),
      sql`, `,
    );
    const res = await this.db.tx((tx) =>
      tx.execute(sql`
        SELECT m.uuid, m.created_at, t.uuid AS template_uuid,
               CASE WHEN d.id IS NOT NULL THEN 'baileys:' || d.uuid::text
                    WHEN c.id IS NOT NULL THEN c.provider || ':' || c.uuid::text END AS sender_key
          FROM scheduled_messages m
          LEFT JOIN wa_templates t ON t.org_id = m.org_id AND t.id = m.template_id
          LEFT JOIN devices d ON d.org_id = m.org_id AND d.id = m.device_id AND coalesce(m.provider, 'baileys') = 'baileys'
          LEFT JOIN wa_provider_configs c ON c.org_id = m.org_id AND c.id = m.device_id AND m.provider IN ('waba', 'twilio', 'sms')
         WHERE m.org_id = ${orgId} AND m.uuid IN (${ids})`),
    );
    for (const r of res.rows as Array<{
      uuid: string;
      created_at: string | Date;
      template_uuid: string | null;
      sender_key: string | null;
    }>) {
      out.set(r.uuid, {
        templateId: r.template_uuid,
        senderKey: r.sender_key,
        createdAt: new Date(r.created_at),
      });
    }
    return out;
  }
}
