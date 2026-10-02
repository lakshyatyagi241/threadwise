import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface VisitorRow {
  id: number;
  visitorUuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  conversationId: number | null;
}

interface Raw {
  id: number | string;
  visitor_uuid: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  conversation_id: number | string | null;
}

const toRow = (r: Raw): VisitorRow => ({
  id: Number(r.id),
  visitorUuid: r.visitor_uuid,
  name: r.name,
  email: r.email,
  phone: r.phone,
  conversationId: r.conversation_id === null ? null : Number(r.conversation_id),
});

const COLUMNS = sql`id, visitor_uuid, name, email, phone, conversation_id`;

/** One row per anonymous browser per widget (TW-WGT-011). */
@Injectable()
export class WidgetVisitorsRepository {
  /**
   * Matches the uuid AND the widget: a uuid another widget (or another workspace) issued never resolves here, so replaying
   * it cannot reach a foreign conversation.
   */
  async find(
    tx: Tx,
    orgId: number,
    widgetId: number,
    uuid: string,
  ): Promise<VisitorRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM chatbot_widget_visitors
      WHERE org_id = ${orgId} AND widget_id = ${widgetId} AND visitor_uuid = ${uuid}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /** The server mints the uuid; a client-supplied one that does not exist is never adopted. */
  async create(
    tx: Tx,
    orgId: number,
    widgetId: number,
    seen: { referrer: string; userAgent: string; ip: string },
  ): Promise<VisitorRow> {
    const res = await tx.execute(sql`
      INSERT INTO chatbot_widget_visitors (org_id, widget_id, visitor_uuid, first_seen_at, last_seen_at, referrer_url,
                                           user_agent, ip)
      VALUES (${orgId}, ${widgetId}, ${randomUUID()}, now(), now(), ${seen.referrer}, ${seen.userAgent}, ${seen.ip})
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as unknown as Raw);
  }

  /** `minAgeSeconds` debounces the high-frequency history poll; the other calls always refresh. */
  async touch(tx: Tx, orgId: number, id: number, minAgeSeconds = 0): Promise<void> {
    await tx.execute(sql`
      UPDATE chatbot_widget_visitors SET last_seen_at = now()
      WHERE org_id = ${orgId} AND id = ${id}
        AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => ${minAgeSeconds}))`);
  }

  /** Last non-empty write wins; an empty or unchanged value leaves the stored one alone (TW-WGT-014 rule 2). */
  async updateProfile(
    tx: Tx,
    orgId: number,
    id: number,
    p: { name?: string | null; email?: string | null; phone?: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE chatbot_widget_visitors SET
        name = COALESCE(NULLIF(${p.name ?? null}::text, ''), name),
        email = COALESCE(NULLIF(${p.email ?? null}::text, ''), email),
        phone = COALESCE(NULLIF(${p.phone ?? null}::text, ''), phone)
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
