import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { assemblePhone } from '../catalog-rules';
import type { AudienceContact, AudienceDirectory, AudienceGroup } from './tokens';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Reads `contacts`, `contact_groups` and `contact_group_members` directly until the CRM module exports a lookup. Archived
 * contacts are left out: here archiving is how a contact is deleted, and a send must not reach someone the workspace removed.
 */
@Injectable()
export class SqlAudienceDirectory implements AudienceDirectory {
  async groups(tx: Tx, orgId: number): Promise<AudienceGroup[]> {
    const res = await tx.execute(sql`
      SELECT g.id, g.uuid, g.name,
             (SELECT count(*) FROM contact_group_members m
                JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id AND NOT c.is_archived
              WHERE m.org_id = g.org_id AND m.group_id = g.id) AS member_count
      FROM contact_groups g
      WHERE g.org_id = ${orgId}
      ORDER BY lower(g.name), g.id`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid as string,
      name: r.name as string,
      count: Number(r.member_count),
    }));
  }

  async contacts(
    tx: Tx,
    orgId: number,
    opts: { q?: string; limit: number },
  ): Promise<AudienceContact[]> {
    const like = opts.q ? `%${escapeLike(opts.q)}%` : null;
    const res = await tx.execute(sql`
      SELECT uuid, name, phone, country_code
      FROM contacts
      WHERE org_id = ${orgId} AND NOT is_archived
        ${like ? sql`AND (name ILIKE ${like} OR phone ILIKE ${like})` : sql``}
      ORDER BY id DESC
      LIMIT ${opts.limit}`);
    return (res.rows as Array<Record<string, unknown>>).map((r) => ({
      uuid: r.uuid as string,
      name: (r.name as string | null) ?? null,
      mobile: assemblePhone(r.phone as string | null, r.country_code as string | null) || null,
    }));
  }

  async phonesOfContacts(tx: Tx, orgId: number, uuids: readonly string[]): Promise<string[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT phone, country_code FROM contacts
      WHERE org_id = ${orgId} AND NOT is_archived AND uuid = ANY(${sql.raw(uuidArray(uuids))})
      ORDER BY id`);
    return (res.rows as Array<Record<string, unknown>>).map((r) =>
      assemblePhone(r.phone as string | null, r.country_code as string | null),
    );
  }

  async phonesOfGroups(tx: Tx, orgId: number, uuids: readonly string[]): Promise<string[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT c.phone, c.country_code
      FROM contact_group_members m
      JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id
      JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id AND NOT c.is_archived
      WHERE m.org_id = ${orgId} AND g.uuid = ANY(${sql.raw(uuidArray(uuids))})
      ORDER BY c.id`);
    return (res.rows as Array<Record<string, unknown>>).map((r) =>
      assemblePhone(r.phone as string | null, r.country_code as string | null),
    );
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A literal `ARRAY['..']::uuid[]` built only from strings that matched the uuid pattern, so nothing can be injected. */
function uuidArray(uuids: readonly string[]): string {
  const safe = uuids.filter((u) => UUID.test(u));
  return safe.length === 0
    ? `ARRAY[]::uuid[]`
    : `ARRAY[${safe.map((u) => `'${u}'`).join(',')}]::uuid[]`;
}
