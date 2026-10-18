import type { StorageCategory } from '@crm/contracts';

/**
 * The rows that OWN an object key: the closed map the backfill reads sizes from, the reconcile links `pending` registry rows through, and
 * (phase S5) the orphan check anti-joins against. The spec's "owner map is the `fileKeyColumns` catalogue ADR-0028 already uses"
 * (docs/specs/storage-quota-and-archival.md 4.4), written down once per metered kind.
 *
 * Table and column names are interpolated into SQL by the repository; they are constants in this file, never input. A new kind of file
 * adds its owner here in the same change as its writer (the coverage test names the writer; this names the row).
 */
export interface OwnerSource {
  /** Stable name, for logs and the wiring map. */
  id: string;
  table: string;
  idColumn: string;
  keyColumn: string;
  /** Extra condition on the table (a SQL fragment of constants). */
  where?: string;
  /**
   * Where the byte count comes from: a column the server wrote (`column`), or the object store (`probe`: local disk or one HEAD, for
   * the kinds that keep no size column). A client's claim (`contact_files.file_size_bytes`) is never used.
   */
  size: { column: string } | { probe: true };
  /** The category, or the SQL expression over the table's columns that picks it. */
  category: StorageCategory | { sql: string; values: Record<string, StorageCategory>; fallback: StorageCategory };
}

export const OWNER_SOURCES: readonly OwnerSource[] = [
  {
    id: 'messages.media_key',
    table: 'messages',
    idColumn: 'id',
    keyColumn: 'media_key',
    size: { column: 'media_size' },
    // A file the customer sent is inbound media (cannot be refused); one an agent, a flow or the API sent is inbox media.
    category: {
      sql: 'direction',
      values: { in: 'inbox_media_inbound', out: 'inbox_media' },
      fallback: 'inbox_media',
    },
  },
  {
    id: 'scheduled_media.storage_key',
    table: 'scheduled_media',
    idColumn: 'id',
    keyColumn: 'storage_key',
    size: { column: 'size_bytes' },
    category: 'scheduled_media',
  },
  {
    id: 'mail_outbound_attachments.object_key',
    table: 'mail_outbound_attachments',
    idColumn: 'id',
    keyColumn: 'object_key',
    size: { column: 'size' },
    category: 'email_attachment_staged',
  },
  {
    id: 'wa_calls.recording_path',
    table: 'wa_calls',
    idColumn: 'id',
    keyColumn: 'recording_path',
    size: { probe: true },
    category: 'call_recording',
  },
  {
    id: 'contact_files.storage_key',
    table: 'contact_files',
    idColumn: 'id',
    keyColumn: 'storage_key',
    // The row's own `file_size_bytes` is a client claim; the object is measured instead.
    size: { probe: true },
    category: 'contact_file',
  },
  {
    id: 'ai_training_sources.file_path',
    table: 'ai_training_sources',
    idColumn: 'id',
    keyColumn: 'file_path',
    size: { probe: true },
    category: 'ai_training_file',
  },
];

/** Pages are read this many rows at a time. */
export const BACKFILL_PAGE = 500;
