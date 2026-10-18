import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactNotes, contacts, users } = schema;
const createdByUser = alias(users, 'created_by_user');
const updatedByUser = alias(users, 'updated_by_user');

export interface ContactNoteRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  body: string;
  createdBy: number | null;
  createdByUuid: string | null;
  createdByName: string | null;
  updatedBy: number | null;
  updatedByUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Data access for `contact_notes` — the detail page's Notes tab. */
@Injectable()
export class ContactNotesRepository {
  private selection() {
    return {
      id: contactNotes.id,
      uuid: contactNotes.uuid,
      contactId: contactNotes.contactId,
      contactUuid: contacts.uuid,
      body: contactNotes.body,
      createdBy: contactNotes.createdBy,
      createdByUuid: createdByUser.uuid,
      createdByName: createdByUser.fullName,
      updatedBy: contactNotes.updatedBy,
      updatedByUuid: updatedByUser.uuid,
      rowVersion: contactNotes.rowVersion,
      createdAt: contactNotes.createdAt,
      updatedAt: contactNotes.updatedAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contactNotes)
      .innerJoin(
        contacts,
        and(eq(contacts.orgId, contactNotes.orgId), eq(contacts.id, contactNotes.contactId)),
      )
      .leftJoin(
        createdByUser,
        and(
          eq(createdByUser.orgId, contactNotes.orgId),
          eq(createdByUser.id, contactNotes.createdBy),
        ),
      )
      .leftJoin(
        updatedByUser,
        and(
          eq(updatedByUser.orgId, contactNotes.orgId),
          eq(updatedByUser.id, contactNotes.updatedBy),
        ),
      );
  }

  async listByContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    filter: { limit: number; cursor?: string },
  ): Promise<ContactNoteRow[]> {
    const conditions = [eq(contactNotes.orgId, orgId), eq(contactNotes.contactId, contactId)];
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(contactNotes.createdAt, cursor.createdAt),
          and(eq(contactNotes.createdAt, cursor.createdAt), lt(contactNotes.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(contactNotes.createdAt), desc(contactNotes.id))
      .limit(filter.limit + 1);
    return rows as ContactNoteRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactNoteRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactNotes.orgId, orgId), eq(contactNotes.uuid, uuid)),
    );
    return rows[0] as ContactNoteRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactNoteRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactNotes.orgId, orgId), eq(contactNotes.id, id)),
    );
    return rows[0] as ContactNoteRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: { contactId: number; body: string; createdBy: number | null },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactNotes)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        contactId: values.contactId,
        body: values.body,
        createdBy: values.createdBy,
        updatedBy: values.createdBy,
      })
      .returning({ id: contactNotes.id, uuid: contactNotes.uuid });
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
      .update(contactNotes)
      .set(values)
      .where(
        and(
          eq(contactNotes.orgId, orgId),
          eq(contactNotes.id, id),
          eq(contactNotes.rowVersion, expectedVersion),
        ),
      )
      .returning({ id: contactNotes.id });
    return result.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactNotes)
      .where(and(eq(contactNotes.orgId, orgId), eq(contactNotes.id, id)))
      .returning({ id: contactNotes.id });
    return result.length > 0;
  }
}
