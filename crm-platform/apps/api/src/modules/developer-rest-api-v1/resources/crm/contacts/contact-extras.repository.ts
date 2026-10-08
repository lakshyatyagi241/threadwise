import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/**
 * WaDesk's contact fields that `ContactsService` does not carry (title, middle name, language, address, the typed country code and the
 * note). The columns exist on `contacts` (con overlay); this writes them inside the same request so the API loses no field. `data` is
 * touched only to drop attribute keys that a replacing `attributes` removed (the service merges custom fields, it never deletes a key).
 */
export interface ContactExtras {
  title: string | null;
  middleName: string | null;
  language: string | null;
  address: string | null;
  countryCode: string | null;
  message: string | null;
}

const COLUMNS: Record<keyof ContactExtras, string> = {
  title: 'title',
  middleName: 'middle_name',
  language: 'language',
  address: 'address',
  countryCode: 'country_code',
  message: 'message',
};

@Injectable()
export class ContactExtrasRepository {
  async read(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<(ContactExtras & { id: number }) | undefined> {
    const res = await tx.execute(
      sql`SELECT id, title, middle_name, language, address, country_code, message FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      | {
          id: string | number;
          title: string | null;
          middle_name: string | null;
          language: string | null;
          address: string | null;
          country_code: string | null;
          message: string | null;
        }
      | undefined;
    if (!r) return undefined;
    return {
      id: Number(r.id),
      title: r.title,
      middleName: r.middle_name,
      language: r.language,
      address: r.address,
      countryCode: r.country_code,
      message: r.message,
    };
  }

  /** Writes only the keys present in `patch`; `dropKeys` are removed from the custom-field object. */
  async write(
    tx: Tx,
    orgId: number,
    id: number,
    patch: Partial<ContactExtras>,
    dropKeys: readonly string[] = [],
  ): Promise<void> {
    const sets = (Object.keys(patch) as Array<keyof ContactExtras>)
      .filter((k) => patch[k] !== undefined)
      .map((k) => sql`${sql.raw(COLUMNS[k])} = ${patch[k]}`);
    if (dropKeys.length > 0)
      sets.push(sql`data = ${dropKeys.reduce((acc, k) => sql`${acc} - ${k}::text`, sql`data`)}`);
    if (sets.length === 0) return;
    await tx.execute(
      sql`UPDATE contacts SET ${sql.join(sets, sql`, `)} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }
}
