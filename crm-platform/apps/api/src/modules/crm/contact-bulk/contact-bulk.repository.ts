import { Injectable } from '@nestjs/common';
import { and, desc, sql, type SQL } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';

const { contacts } = schema;

/** Who is acting, for the audit and outbox rows the set-based statements write themselves. */
export interface ActorMeta {
  actorId: number | null;
  actorType: string;
  requestId: string | null;
}

const metaJson = (m: ActorMeta) =>
  JSON.stringify({ requestId: m.requestId, actorType: m.actorType, actorId: m.actorId });

export interface ExportRow {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  countryCode: string | null;
  email: string | null;
  language: string | null;
  title: string | null;
  address: string | null;
  message: string | null;
  status: string | null;
  source: string | null;
  isUnsubscribed: boolean;
  createdAt: Date;
  /** The owner's login email, or null for an unassigned contact. */
  ownerEmail: string | null;
  data: Record<string, unknown>;
}

/**
 * The set-based half of bulk actions.
 *
 * "Select all 40,000 matching this filter" must not be 40,000 round trips. Each statement here
 * does the whole change in one go and, in the same statement, writes the outbox rows (and for
 * deletes the audit rows) for exactly the contacts it changed: the transaction is still the
 * unit, the events still cannot disagree with the data, it just does not loop in JavaScript.
 *
 * `where` is the shared contact filter (contact-conditions.ts), so these touch precisely the
 * rows the list shows. It references `contacts`, which every statement selects FROM unaliased.
 */
@Injectable()
export class ContactBulkRepository {
  async count(tx: Tx, where: SQL): Promise<number> {
    const res = await tx.execute(sql`SELECT count(*)::int AS n FROM contacts WHERE ${where}`);
    return Number((res.rows[0] as { n: number }).n);
  }

  async uuids(tx: Tx, where: SQL, limit: number): Promise<string[]> {
    const res = await tx.execute(
      sql`SELECT contacts.uuid FROM contacts WHERE ${where} ORDER BY contacts.id LIMIT ${limit}`,
    );
    return (res.rows as Array<{ uuid: string }>).map((r) => r.uuid);
  }

  async addToGroup(
    tx: Tx,
    orgId: number,
    where: SQL,
    group: { id: number; uuid: string },
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH ins AS (
        INSERT INTO contact_group_members (org_id, contact_id, group_id)
        SELECT ${orgId}::bigint, contacts.id, ${group.id}::bigint FROM contacts WHERE ${where}
        ON CONFLICT (org_id, contact_id, group_id) DO NOTHING
        RETURNING contact_id
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', ins.contact_id, 'contact.group_added',
               jsonb_build_object('uuid', c.uuid, 'groupId', ${group.uuid}::text,
                                  '_meta', ${metaJson(meta)}::jsonb)
        FROM ins JOIN contacts c ON c.org_id = ${orgId}::bigint AND c.id = ins.contact_id
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM ins)::int AS changed
    `);
    return Number((res.rows[0] as { changed: number }).changed);
  }

  async removeFromGroup(
    tx: Tx,
    orgId: number,
    where: SQL,
    group: { id: number; uuid: string },
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH del AS (
        DELETE FROM contact_group_members m USING contacts
        WHERE m.org_id = ${orgId}::bigint AND m.group_id = ${group.id}::bigint
          AND m.contact_id = contacts.id AND ${where}
        RETURNING m.contact_id
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', del.contact_id, 'contact.group_removed',
               jsonb_build_object('uuid', c.uuid, 'groupId', ${group.uuid}::text,
                                  '_meta', ${metaJson(meta)}::jsonb)
        FROM del JOIN contacts c ON c.org_id = ${orgId}::bigint AND c.id = del.contact_id
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM del)::int AS changed
    `);
    return Number((res.rows[0] as { changed: number }).changed);
  }

  /**
   * Hands every contact the filter matches to `owner` (null = nobody) in one statement, skipping the ones already
   * there. The statement writes what a single edit writes, for exactly the contacts it changed: the audit row with the
   * old and new owner, and a `contact.updated` event. `row_version` and `updated_at` move through the table trigger.
   */
  async setOwner(
    tx: Tx,
    orgId: number,
    where: SQL,
    owner: { id: number | null; uuid: string | null },
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT contacts.id, contacts.uuid, prev.uuid AS prev_owner
        FROM contacts
        LEFT JOIN users prev ON prev.org_id = contacts.org_id AND prev.id = contacts.owner_id
        WHERE ${where} AND contacts.owner_id IS DISTINCT FROM ${owner.id}::bigint
      ), upd AS (
        UPDATE contacts SET owner_id = ${owner.id}::bigint, updated_by = ${meta.actorId}::bigint
        FROM picked
        WHERE contacts.org_id = ${orgId}::bigint AND contacts.id = picked.id
        RETURNING contacts.id, picked.uuid, picked.prev_owner
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
        SELECT ${orgId}::bigint, ${meta.actorId}::bigint, ${meta.actorType}, 'contacts', upd.id, 'update',
               jsonb_build_object('ownerId', jsonb_build_object('old', upd.prev_owner, 'new', ${owner.uuid}::text)),
               ${meta.requestId}
        FROM upd
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', upd.id, 'contact.updated',
               jsonb_build_object('uuid', upd.uuid, 'ownerId', ${owner.uuid}::text,
                                  'previousOwnerId', upd.prev_owner, '_meta', ${metaJson(meta)}::jsonb)
        FROM upd
      )
      SELECT count(*)::int AS n FROM upd
    `);
    return Number((res.rows[0] as { n: number }).n);
  }

  async addTag(
    tx: Tx,
    orgId: number,
    where: SQL,
    tag: { id: number; uuid: string },
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH ins AS (
        INSERT INTO contact_tags (org_id, contact_id, tag_id, created_by)
        SELECT ${orgId}::bigint, contacts.id, ${tag.id}::bigint, ${meta.actorId}::bigint
        FROM contacts WHERE ${where}
        ON CONFLICT (org_id, contact_id, tag_id) DO NOTHING
        RETURNING contact_id
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', ins.contact_id, 'contact.tag_added',
               jsonb_build_object('uuid', c.uuid, 'tagId', ${tag.uuid}::text,
                                  '_meta', ${metaJson(meta)}::jsonb)
        FROM ins JOIN contacts c ON c.org_id = ${orgId}::bigint AND c.id = ins.contact_id
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM ins)::int AS changed
    `);
    return Number((res.rows[0] as { changed: number }).changed);
  }

  async removeTag(
    tx: Tx,
    orgId: number,
    where: SQL,
    tag: { id: number; uuid: string },
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH del AS (
        DELETE FROM contact_tags t USING contacts
        WHERE t.org_id = ${orgId}::bigint AND t.tag_id = ${tag.id}::bigint
          AND t.contact_id = contacts.id AND ${where}
        RETURNING t.contact_id
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', del.contact_id, 'contact.tag_removed',
               jsonb_build_object('uuid', c.uuid, 'tagId', ${tag.uuid}::text,
                                  '_meta', ${metaJson(meta)}::jsonb)
        FROM del JOIN contacts c ON c.org_id = ${orgId}::bigint AND c.id = del.contact_id
        RETURNING 1
      )
      SELECT (SELECT count(*) FROM del)::int AS changed
    `);
    return Number((res.rows[0] as { changed: number }).changed);
  }

  /** The ids the next `deleteBatch` call with the same arguments will delete (same order, same limit). */
  async nextIds(tx: Tx, where: SQL, batch: number): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT contacts.id FROM contacts WHERE ${where} ORDER BY contacts.id LIMIT ${batch}`,
    );
    return (res.rows as Array<{ id: number | string }>).map((r) => Number(r.id));
  }

  /**
   * Deletes up to `batch` matching contacts with one audit row and one event each (the trail
   * must survive the rows). Call until it returns 0. Cascades and SET NULL foreign keys take
   * care of everything that pointed at them.
   */
  async deleteBatch(
    tx: Tx,
    orgId: number,
    where: SQL,
    batch: number,
    meta: ActorMeta,
  ): Promise<number> {
    const res = await tx.execute(sql`
      WITH picked AS (
        SELECT contacts.id FROM contacts WHERE ${where} ORDER BY contacts.id LIMIT ${batch}
      ), del AS (
        DELETE FROM contacts USING picked
        WHERE contacts.org_id = ${orgId}::bigint AND contacts.id = picked.id
        RETURNING contacts.id, contacts.uuid, contacts.display_id
      ), au AS (
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, request_id)
        SELECT ${orgId}::bigint, ${meta.actorId}::bigint, ${meta.actorType}, 'contacts', del.id,
               'delete', ${meta.requestId}
        FROM del
      ), ev AS (
        INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload)
        SELECT ${orgId}::bigint, 'contacts', del.id, 'contact.deleted',
               jsonb_build_object('uuid', del.uuid, 'displayId', del.display_id,
                                  '_meta', ${metaJson(meta)}::jsonb)
        FROM del
      )
      SELECT count(*)::int AS n FROM del
    `);
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Newest first, keyset on (created_at, id) so a big export never pays for OFFSET. */
  async exportBatch(
    tx: Tx,
    conditions: SQL[],
    after: { createdAt: Date; id: number } | undefined,
    limit: number,
  ): Promise<ExportRow[]> {
    const all = [...conditions];
    if (after) {
      all.push(
        sql`(${contacts.createdAt}, ${contacts.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::bigint)`,
      );
    }
    const rows = await tx
      .select({
        id: contacts.id,
        name: contacts.name,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        phone: contacts.phone,
        countryCode: contacts.countryCode,
        email: contacts.email,
        language: contacts.language,
        title: contacts.title,
        address: contacts.address,
        message: contacts.message,
        status: contacts.status,
        source: contacts.source,
        isUnsubscribed: contacts.isUnsubscribed,
        createdAt: contacts.createdAt,
        ownerEmail: sql<
          string | null
        >`(SELECT u.email FROM users u WHERE u.org_id = ${contacts.orgId} AND u.id = ${contacts.ownerId})`,
        data: contacts.data,
      })
      .from(contacts)
      .where(and(...all))
      .orderBy(desc(contacts.createdAt), desc(contacts.id))
      .limit(limit);
    return rows as ExportRow[];
  }
}
