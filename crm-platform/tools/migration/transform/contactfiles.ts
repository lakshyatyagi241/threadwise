import { cutText, isDeleted, str, type Doc } from '../util';
import type { Source } from '../extract/source';
import { c, times } from './common';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

/**
 * contact_files (+ the attachments registry rows with the same id) -> contact_files (migration 0017).
 *
 * A Waboo `contact_files` document is only the LABEL of a file: { id, contact_id, file_name, file_size (a rounded display string such as
 * "12.3 KB"), file_type (".jpeg"), uploaded_by (display name), created_by (user id), uploaded_at, downloads, is_deleted }. It carries no
 * address. The file itself is the `attachments` registry row with THE SAME `id` (checked on rhythm: 3 of 3 contact files have exactly one
 * such row, with `source` = https URL without a query string, `directory_prefix`, `file_extension`, `file_size`). That row is read with the
 * document (`read` below, shipped as `_attachment`); no match, no URL or a URL that is not http(s) = quarantined (nothing to copy).
 *
 * `storage_key` is written holding the Waboo URL; pilot/files/copy-files.cjs downloads it (allow-listed host, https only) into the
 * documents bucket as `contact-files/<org id>/waboo/<hash>/<name>`, rewrites storage_key to that bare key and sets file_size_bytes and
 * mime_type from the real object. Until then the row points at a URL and the app has nothing to serve for it (there is no file-bytes reader
 * for contact_files in the app yet). contact_files has no touch trigger, row_version or updated_at; the INSERT trigger set is empty, so the
 * app's outbox / audit / last_activity bump (ContactFilesService.create) are NOT run: this is history, not an upload.
 */
const asObj = (v: unknown): Doc | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Doc) : null;

/** The registry row of a contact file: same `id`. Only the fields the transform needs travel with the document. */
export async function* readWithAttachments(a: {
  source: Source;
  client: string;
}): AsyncGenerator<Doc> {
  const { source, client } = a;
  if (!source.collections(client).includes('contact_files')) return;
  const byId = new Map<string, Doc>();
  if (source.collections(client).includes('attachments'))
    for await (const att of source.read(client, 'attachments')) {
      const id = str(att.id);
      if (id && !byId.has(id)) byId.set(id, att);
    }
  for await (const d of source.read(client, 'contact_files')) {
    const id = str(d.id);
    const att = id ? byId.get(id) : undefined;
    yield att
      ? {
          ...d,
          _attachment: {
            source: att.source,
            file_size: att.file_size,
            is_deleted: att.is_deleted,
            deleted_time: att.deleted_time,
          },
        }
      : d;
  }
}

/** WaDesk's contract for a file name (createContactFileSchema): no path separator, not "." / "..", no control character, 1..255. */
export function cleanFileName(raw: string): string {
  const n0 = [...raw]
    .map((ch) => (ch === '/' || ch === '\\' ? '_' : ch.charCodeAt(0) < 32 ? '' : ch))
    .join('')
    .trim();
  const n = cutText(n0, 255);
  return n === '.' || n === '..' ? '' : n;
}

const exactBytes = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;

export const contactFiles: HandlerSpec = {
  handler: 'contact_files',
  collection: 'contact_files',
  mapCollection: 'contact_files',
  shaCollections: ['attachments'],
  read: ({ source, client }) => readWithAttachments({ source, client }),
  tables: {
    contact_files: {
      columns: [
        c('contact_id', 'bigint'),
        c('file_name', 'text'),
        c('file_size_bytes', 'bigint'),
        c('storage_key', 'text'),
        c('uploaded_by', 'bigint'),
        c('created_at', 'timestamptz'),
      ],
      // the files copy (pilot/files/copy-files.cjs) replaces the URL by the object key and fills the size and the type: not compared
      skipCompare: ['storage_key', 'file_size_bytes'],
      liveColumns: ['storage_key', 'file_size_bytes'],
      constants: {},
    },
  },
  fields: {
    _id: 'id',
    id: 'id (the attachments registry row with the same id holds the file)',
    contact_id: 'col:contact_id (resolved through id_map)',
    file_name: 'col:file_name (path separators and control characters replaced, 255 characters)',
    file_size:
      'drop:rounded display string ("12.3 KB"), not a byte count; file_size_bytes comes from the attachments row or the copied object',
    file_type:
      'drop:the extension (".jpeg"); mime_type is set by the files copy from the downloaded content type',
    uploaded_by: 'drop:display name of the uploader; no column (the user is created_by)',
    created_by: 'col:uploaded_by (the migrated Waboo user; soft UNRESOLVED_USER when there is none)',
    uploaded_at: 'col:created_at',
    created_time: 'col:created_at (fallback)',
    downloads: 'drop:download counter; contact_files has no column for it',
    is_deleted: 'drop:soft-delete flag; deleted files are excluded and counted',
    deleted_time: 'drop:soft-delete timestamp',
    _attachment:
      'col:storage_key (the registry `source` URL until the files copy), file_size_bytes (registry file_size when exact)',
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'is_deleted or deleted_time is set' };
    const att = asObj(doc._attachment);
    if (att && isDeleted(att))
      return {
        kind: 'exclude',
        code: 'SOFT_DELETED',
        reason: 'the registry row of the file is deleted',
      };
    const ckey = str(doc.contact_id);
    const contact = ckey ? ctx.ref('contact_list', ckey) : undefined;
    if (!contact || contact.table !== 'contacts') {
      if (ckey && ctx.idx.contactDeleted.has(ckey))
        return {
          kind: 'exclude',
          code: 'PARENT_EXCLUDED',
          reason: 'the contact is soft-deleted',
        };
      return {
        kind: 'quarantine',
        code: 'ORPHAN_CONTACT',
        reason: `contact ${ckey ?? '(none)'} is not a migrated contact`,
      };
    }
    const name = cleanFileName(str(doc.file_name) ?? '');
    if (!name) return { kind: 'quarantine', code: 'EMPTY_NAME', reason: 'the file has no usable name' };
    if (!att)
      return {
        kind: 'quarantine',
        code: 'NO_FILE_URL',
        reason: 'no attachments row with this id: the dump holds no address for the file',
      };
    const url = str(att.source);
    let parsed: URL | null = null;
    try {
      parsed = url ? new URL(url) : null;
    } catch {
      parsed = null;
    }
    if (!url || !parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:'))
      return {
        kind: 'quarantine',
        code: 'NO_FILE_URL',
        reason: 'the attachments row has no http(s) address: there is nothing to copy',
      };

    const t = times(doc, ctx.fallbackAt, ['uploaded_at', 'created_time', 'created_at'], []);
    const soft: Soft[] = [...t.soft];
    if (name !== str(doc.file_name))
      soft.push({
        code: 'FILE_NAME_CLEANED',
        reason: 'the name had a path separator, control character or was too long; WaDesk refuses those in a file name',
      });
    if (parsed.search !== '' || parsed.username !== '' || parsed.password !== '')
      soft.push({
        code: 'URL_QUERY_KEPT',
        reason:
          'the address carries a query string or credentials (a signed link); it is kept in storage_key until the files copy replaces it',
      });
    let uploadedBy: number | null = null;
    const cb = str(asObj(doc.created_by)?.id ?? doc.created_by);
    if (ctx.idx.hasUsers && cb) {
      const ref = ctx.ref('user', cb);
      if (ref && ref.table === 'users') uploadedBy = ref.id;
      else
        soft.push({
          code: 'UNRESOLVED_USER',
          reason: 'created_by matches no migrated user; uploaded_by is left empty',
        });
    }
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'contact_files',
          sub: '',
          row: {
            contact_id: contact.id,
            file_name: name,
            file_size_bytes: exactBytes(att.file_size),
            storage_key: url,
            uploaded_by: uploadedBy,
            created_at: t.created,
          },
        },
      ],
    };
  },
};
