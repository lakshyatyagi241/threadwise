import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';

const { contactFiles, contacts, users } = schema;

export interface ContactFileRow {
  id: number;
  uuid: string;
  contactId: number;
  contactUuid: string;
  fileName: string;
  fileSizeBytes: number | null;
  storageKey: string;
  mimeType: string | null;
  uploadedBy: number | null;
  uploadedByUuid: string | null;
  createdAt: Date;
}

/** Data access for `contact_files` — metadata only, see 0017's migration comment. */
@Injectable()
export class ContactFilesRepository {
  private selection() {
    return {
      id: contactFiles.id,
      uuid: contactFiles.uuid,
      contactId: contactFiles.contactId,
      contactUuid: contacts.uuid,
      fileName: contactFiles.fileName,
      fileSizeBytes: contactFiles.fileSizeBytes,
      storageKey: contactFiles.storageKey,
      mimeType: contactFiles.mimeType,
      uploadedBy: contactFiles.uploadedBy,
      uploadedByUuid: users.uuid,
      createdAt: contactFiles.createdAt,
    };
  }

  private baseQuery(tx: Tx) {
    return tx
      .select(this.selection())
      .from(contactFiles)
      .innerJoin(
        contacts,
        and(eq(contacts.orgId, contactFiles.orgId), eq(contacts.id, contactFiles.contactId)),
      )
      .leftJoin(
        users,
        and(eq(users.orgId, contactFiles.orgId), eq(users.id, contactFiles.uploadedBy)),
      );
  }

  async listByContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    filter: { limit: number; cursor?: string },
  ): Promise<ContactFileRow[]> {
    const conditions = [eq(contactFiles.orgId, orgId), eq(contactFiles.contactId, contactId)];
    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      conditions.push(
        or(
          lt(contactFiles.createdAt, cursor.createdAt),
          and(eq(contactFiles.createdAt, cursor.createdAt), lt(contactFiles.id, cursor.id)),
        )!,
      );
    }

    const rows = await this.baseQuery(tx)
      .where(and(...conditions))
      .orderBy(desc(contactFiles.createdAt), desc(contactFiles.id))
      .limit(filter.limit + 1);
    return rows as ContactFileRow[];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ContactFileRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactFiles.orgId, orgId), eq(contactFiles.uuid, uuid)),
    );
    return rows[0] as ContactFileRow | undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ContactFileRow | undefined> {
    const rows = await this.baseQuery(tx).where(
      and(eq(contactFiles.orgId, orgId), eq(contactFiles.id, id)),
    );
    return rows[0] as ContactFileRow | undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    values: {
      contactId: number;
      fileName: string;
      fileSizeBytes?: number | null;
      storageKey: string;
      mimeType?: string | null;
      uploadedBy: number | null;
    },
  ): Promise<{ id: number; uuid: string }> {
    const [row] = await tx
      .insert(contactFiles)
      .values({
        orgId,
        uuid: sql`gen_random_uuid()`,
        contactId: values.contactId,
        fileName: values.fileName,
        fileSizeBytes: values.fileSizeBytes ?? null,
        storageKey: values.storageKey,
        mimeType: values.mimeType ?? null,
        uploadedBy: values.uploadedBy,
      })
      .returning({ id: contactFiles.id, uuid: contactFiles.uuid });
    return row!;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const result = await tx
      .delete(contactFiles)
      .where(and(eq(contactFiles.orgId, orgId), eq(contactFiles.id, id)))
      .returning({ id: contactFiles.id });
    return result.length > 0;
  }
}
