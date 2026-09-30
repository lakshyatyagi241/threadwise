import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactActivities, contacts, users } = schema;

export interface ContactActivityRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  activityType: string;
  title: string;
  body: string | null;
  source: string;
  actorId: number | null;
  actorUuid: string | null;
  occurredAt: Date;
  createdAt: Date;
}

/** Data access for `contact_activities` — the detail page's Activity Timeline sub-tab. */
@Injectable()
export class ContactActivitiesRepository {
  private selection() {
    return {
      id: contactActivities.id,
      uuid: contactActivities.uuid,
      contactId: contactActivities.contactId,
      contactUuid: contacts.uuid,
      activityType: contactActivities.activityType,
      title: contactActivities.title,
      body: contactActivities.body,
      source: contactActivities.source,
      actorId: contactActivities.actorId,
      actorUuid: users.uuid,
      occurredAt: contactActivities.occurredAt,
      createdAt: contactActivities.createdAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contactActivities)
      .innerJoin(
        contacts,
        and(
          eq(contacts.orgId, contactActivities.orgId),
          eq(contacts.id, contactActivities.contactId),
        ),
      )
      .leftJoin(
        users,
        and(eq(users.orgId, contactActivities.orgId), eq(users.id, contactActivities.actorId)),
      );
  }

  async listByContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    filter: { limit: number; cursor?: string },
  ): Promise<ContactActivityRow[]> {
    const conditions = [
      eq(contactActivities.orgId, orgId),
      eq(contactActivities.contactId, contactId),
    ];
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(contactActivities.occurredAt, cursor.createdAt),
          and(
            eq(contactActivities.occurredAt, cursor.createdAt),
            lt(contactActivities.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(contactActivities.occurredAt), desc(contactActivities.id))
      .limit(filter.limit + 1);
    return rows as ContactActivityRow[];
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactActivityRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactActivities.orgId, orgId), eq(contactActivities.id, id)),
    );
    return rows[0] as ContactActivityRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      contactId: number;
      activityType: string;
      title: string;
      body?: string | null;
      source: string;
      actorId: number | null;
      occurredAt?: Date;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactActivities)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        contactId: values.contactId,
        activityType: values.activityType,
        title: values.title,
        body: values.body ?? null,
        source: values.source,
        actorId: values.actorId,
        occurredAt: values.occurredAt ?? sql`now()`,
      })
      .returning({ id: contactActivities.id, uuid: contactActivities.uuid });
    return row!;
  }
}
