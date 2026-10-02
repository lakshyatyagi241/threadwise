import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { PlatformStore } from '../auth';

export interface ExtensionRow {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  version: string;
  status: 'active' | 'disabled';
  /** Paths relative to the modules directory, the list uninstall removes. */
  files: string[] | null;
  manifest: unknown;
  installed_at: string | null;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id::int AS id, uuid, slug, name, version, status, files, manifest, installed_at, row_version`,
);

/**
 * SQL for the `extensions` table, and the only door through which this module opens a privileged transaction:
 * `extensions` accepts reads and writes only under the privileged flag (the registry is the platform's, not a
 * tenant's), so every call goes through the auth module's PlatformStore. Nothing here accepts SQL from a caller.
 */
@Injectable()
export class ExtensionStore {
  constructor(private readonly platform: PlatformStore) {}

  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.platform.tx(fn);
  }

  async list(tx: Tx): Promise<ExtensionRow[]> {
    const res = await tx.execute(sql`SELECT ${COLUMNS} FROM extensions ORDER BY name ASC, slug ASC`);
    return res.rows as unknown as ExtensionRow[];
  }

  async byUuid(tx: Tx, uuid: string, lock = false): Promise<ExtensionRow | null> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${COLUMNS} FROM extensions WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${COLUMNS} FROM extensions WHERE uuid = ${uuid}::uuid`,
    );
    return (res.rows[0] as unknown as ExtensionRow | undefined) ?? null;
  }

  async bySlug(tx: Tx, slug: string): Promise<ExtensionRow | null> {
    const res = await tx.execute(sql`SELECT ${COLUMNS} FROM extensions WHERE slug = ${slug}`);
    return (res.rows[0] as unknown as ExtensionRow | undefined) ?? null;
  }

  /** Serialises installs of one slug (two operators uploading the same package at the same moment). */
  async lockSlug(tx: Tx, slug: string): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`extension:${slug}`}))`);
  }

  /**
   * Insert or upgrade by slug (WD-ADD-005 rule 6): the row is updated in place, the file list is replaced, the
   * status is forced back to active, and the purchase code is only overwritten when a new one is given.
   */
  async upsert(
    tx: Tx,
    input: {
      slug: string;
      name: string;
      version: string;
      files: string[];
      manifest: unknown;
      purchaseCodeEncrypted: string | null;
      operatorId: number | null;
    },
  ): Promise<{ row: ExtensionRow; upgraded: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO extensions (slug, name, version, status, files, manifest, purchase_code, installed_at, installed_by)
      VALUES (${input.slug}, ${input.name}, ${input.version}, 'active', ${JSON.stringify(input.files)}::jsonb,
              ${JSON.stringify(input.manifest)}::jsonb, ${input.purchaseCodeEncrypted}, now(), ${input.operatorId})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, version = EXCLUDED.version, status = 'active', files = EXCLUDED.files,
        manifest = EXCLUDED.manifest, installed_at = now(), installed_by = EXCLUDED.installed_by,
        purchase_code = COALESCE(EXCLUDED.purchase_code, extensions.purchase_code)
      RETURNING ${COLUMNS}, (xmax = 0) AS inserted
    `);
    const row = res.rows[0] as unknown as ExtensionRow & { inserted: boolean };
    return { row, upgraded: !row.inserted };
  }

  /** Optimistic: zero rows means someone else changed it first. */
  async setStatus(
    tx: Tx,
    id: number,
    status: 'active' | 'disabled',
    expectedVersion: number,
  ): Promise<ExtensionRow | null> {
    const res = await tx.execute(sql`
      UPDATE extensions SET status = ${status} WHERE id = ${id} AND row_version = ${expectedVersion}
      RETURNING ${COLUMNS}
    `);
    return (res.rows[0] as unknown as ExtensionRow | undefined) ?? null;
  }

  async remove(tx: Tx, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM extensions WHERE id = ${id}`);
  }
}
