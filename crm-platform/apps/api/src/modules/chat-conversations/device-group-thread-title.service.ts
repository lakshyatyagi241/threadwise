import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationsRepository } from './conversations.repository';

/**
 * A personal-number group thread (`g:<bare group id>` on a `whatsapp_qr` channel) is titled from the group's subject when its first
 * message arrives, but the subject can change later (a rename from the screen or from a phone, learned by the directory sync). This
 * keeps the thread in step: the subject is read from `wa_device_groups` itself (the outbox event carries ids only), and the thread of
 * the same device and group is retitled. Idempotent: a title that already matches is left alone. The channel is found through
 * `channels.external_id = devices.uuid` (the official groups' variant joins `waba_config_id`).
 */
@Injectable()
export class DeviceGroupThreadTitleService {
  private readonly logger = new Logger(DeviceGroupThreadTitleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  /** How many threads were retitled (0 when there is no thread yet, the subject is empty, or the title already carries it). */
  async retitle(orgId: number, groupRowId: string): Promise<number> {
    if (!/^\d+$/.test(groupRowId)) return 0;
    const uuids = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE conversations c SET title = left(btrim(g.subject), 200)
          FROM wa_device_groups g
          JOIN devices d ON d.org_id = g.org_id AND d.id = g.device_id
          JOIN channels ch ON ch.org_id = g.org_id AND ch.kind = 'whatsapp_qr' AND ch.external_id = d.uuid::text
         WHERE g.org_id = ${orgId} AND g.id = ${groupRowId}::bigint
           AND btrim(coalesce(g.subject, '')) <> ''
           AND c.org_id = g.org_id AND c.channel_id = ch.id AND c.peer_key = 'g:' || g.group_jid
           AND c.title IS DISTINCT FROM left(btrim(g.subject), 200)
        RETURNING c.uuid`);
      return res.rows.map((r) => String((r as { uuid: string }).uuid));
    });
    for (const uuid of uuids) {
      const conv = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.conversations.byUuid(tx, orgId, uuid),
      );
      if (conv) await this.realtime.conversationChanged(orgId, conv, ['title']);
    }
    if (uuids.length > 0)
      this.logger.debug({ orgId, threads: uuids.length }, 'personal group thread retitled');
    return uuids.length;
  }
}
