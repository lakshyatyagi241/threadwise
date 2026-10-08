import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { ConversationsRepository } from './conversations.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';

/**
 * A WhatsApp group thread is keyed `g:<group id>` and titled from the group's subject, but the title was only set when the first message
 * arrived (docs/specs/waba-groups-management.md 12.5). When the subject changes afterwards (a rename from the screen or a phone, confirmed
 * by `group_settings_update`) the thread follows it. Idempotent: setting a title to what it already is does nothing.
 */
@Injectable()
export class WabaGroupThreadTitleService {
  private readonly logger = new Logger(WabaGroupThreadTitleService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  /** How many threads were retitled (0 when there is no thread yet, or it already carries the subject). */
  async retitle(
    orgId: number,
    connectionUuid: string,
    groupId: string,
    subject: string,
  ): Promise<number> {
    const title = subject.trim().slice(0, 200);
    if (!title || !groupId) return 0;
    const peerKey = `g:${groupId}`.slice(0, 128);
    const uuids = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE conversations c SET title = ${title}
          FROM channels ch
          JOIN wa_provider_configs w ON w.org_id = ch.org_id AND w.id = ch.waba_config_id
         WHERE c.org_id = ${orgId} AND ch.org_id = c.org_id AND ch.id = c.channel_id
           AND w.uuid = ${connectionUuid}::uuid AND c.peer_key = ${peerKey}
           AND c.title IS DISTINCT FROM ${title}
        RETURNING c.uuid`);
      return res.rows.map((r) => String((r as { uuid: string }).uuid));
    });
    for (const uuid of uuids) {
      // The list shows the new title on its next fetch; this nudges the screens that are open.
      const conv = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.conversations.byUuid(tx, orgId, uuid),
      );
      if (conv) await this.realtime.conversationChanged(orgId, conv, ['title']);
    }
    if (uuids.length > 0)
      this.logger.debug({ orgId, threads: uuids.length }, 'group thread retitled');
    return uuids.length;
  }
}
