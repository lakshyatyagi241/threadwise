import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** How long a reply token is trusted: LINE's last about a minute and work once, Reference stops at 55 seconds. */
export const REPLY_TOKEN_TTL_SECONDS = 55;

/**
 * The reply token a person's latest message carried (kept on the message's `meta.line`). A reply made with it is free; a push is
 * billable. Taking it clears it in the same statement, so two replies in one turn cannot both use a single-use token.
 */
@Injectable()
export class ReplyTokensRepository {
  async takeFresh(
    tx: Tx,
    orgId: number,
    channelRowId: number,
    peerKey: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): Promise<string | null> {
    const latest = await tx.execute(sql`
      SELECT m.id, m.meta -> 'line' ->> 'reply_token' AS token, m.meta -> 'line' ->> 'reply_token_at' AS at
      FROM messages m
      JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE m.org_id = ${orgId} AND ch.kind = 'line' AND ch.external_id = ${String(channelRowId)}
        AND c.peer_key = ${peerKey} AND m.direction = 'in'
      ORDER BY m.id DESC LIMIT 1`);
    const row = latest.rows[0] as
      { id: number | string; token: string | null; at: string | null } | undefined;
    if (!row?.token) return null;
    const at = Number(row.at);
    if (!Number.isFinite(at) || at <= 0 || nowSeconds - at >= REPLY_TOKEN_TTL_SECONDS) return null;

    // Only the statement that still sees the token wins it.
    const taken = await tx.execute(sql`
      UPDATE messages SET meta = meta #- '{line,reply_token}'
      WHERE org_id = ${orgId} AND id = ${Number(row.id)} AND meta -> 'line' ->> 'reply_token' = ${row.token}
      RETURNING id`);
    return taken.rows.length > 0 ? row.token : null;
  }
}
