import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactMeetings, contacts, users } = schema;

export interface ContactMeetingRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  location: string | null;
  createdBy: number | null;
  createdByUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Data access for `contact_meetings` — the detail page's Meetings sub-tab. */
@Injectable()
export class ContactMeetingsRepository {
  private selection() {
    return {
      id: contactMeetings.id,
      uuid: contactMeetings.uuid,
      contactId: contactMeetings.contactId,
      contactUuid: contacts.uuid,
      title: contactMeetings.title,
      startsAt: contactMeetings.startsAt,
      endsAt: contactMeetings.endsAt,
      location: contactMeetings.location,
      createdBy: contactMeetings.createdBy,
      createdByUuid: users.uuid,
      rowVersion: contactMeetings.rowVersion,
      createdAt: contactMeetings.createdAt,
      updatedAt: contactMeetings.updatedAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contactMeetings)
      .innerJoin(
        contacts,
        and(eq(contacts.orgId, contactMeetings.orgId), eq(contacts.id, contactMeetings.contactId)),
      )
      .leftJoin(
        users,
        and(eq(users.orgId, contactMeetings.orgId), eq(users.id, contactMeetings.createdBy)),
      );
  }

  /** Ordered/paginated by createdAt (insertion order), not startsAt — startsAt is nullable. */
  async listByContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    filter: { limit: number; cursor?: string },
  ): Promise<ContactMeetingRow[]> {
    const conditions = [eq(contactMeetings.orgId, orgId), eq(contactMeetings.contactId, contactId)];
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(contactMeetings.createdAt, cursor.createdAt),
          and(eq(contactMeetings.createdAt, cursor.createdAt), lt(contactMeetings.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(contactMeetings.createdAt), desc(contactMeetings.id))
      .limit(filter.limit + 1);
    return rows as ContactMeetingRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactMeetingRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.uuid, uuid)),
    );
    return rows[0] as ContactMeetingRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactMeetingRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)),
    );
    return rows[0] as ContactMeetingRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      contactId: number;
      title: string;
      startsAt?: Date | null;
      endsAt?: Date | null;
      location?: string | null;
      createdBy: number | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactMeetings)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        contactId: values.contactId,
        title: values.title,
        startsAt: values.startsAt ?? null,
        endsAt: values.endsAt ?? null,
        location: values.location ?? null,
        createdBy: values.createdBy,
      })
      .returning({ id: contactMeetings.id, uuid: contactMeetings.uuid });
    return row!;
  }

  async updateWithVersion(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const result = await tx
      .update(contactMeetings)
      .set(values)
      .where(
        and(
          eq(contactMeetings.orgId, orgId),
          eq(contactMeetings.id, id),
          eq(contactMeetings.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contactMeetings.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactMeetings)
      .where(and(eq(contactMeetings.orgId, orgId), eq(contactMeetings.id, id)))
      .returning({ id: contactMeetings.id });
    return result.length > 0;
  }
}
