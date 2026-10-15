import { isDeleted, primaryKey, str, toDate, type Doc } from '../util';
import { c, times, TS_COLS } from './common';
import type { Ctx, HandlerSpec, Outcome, Soft } from './types';

/**
 * document_col -> ai_training_sources (the AI knowledge base, URL entries only).
 *
 * A Waboo document_col document is METADATA of a page that was read into an external vector store: { documentId, parentDocumentId,
 * sourceId, sourceType, url, file_path, characters, status, createdOn }. No text and no vectors are in Mongo, and vectors are never
 * copied. A website source becomes a WaDesk `url` entry (workspace-wide, assistant_id NULL: the app lists those for every assistant)
 * that is honest about its state: status `failed`, error NOT_FETCHED. WaDesk answers only from `ready` entries, so nothing is used
 * before the operator-triggered `kb-reingest` command resets the entry to `processing` and emits the app's own
 * `ai_training_source.requested` event. A load never emits it (and never makes an outbound request): `processing` without that event
 * would stay `processing` forever, because the app's worker only settles an entry when the event reaches it.
 * A file source has no bytes here: it is not loaded, it is quarantined NEEDS_REUPLOAD with its file name.
 */

export const NOT_FETCHED = 'Not fetched yet: re-ingest';
/** Marker the stream puts on a document whose url already belongs to an earlier document (never a Waboo field). */
export const DUP_URL_MARK = '__waboo_dup_url';
const LABEL_MAX = 200;
const URL_MAX = 1024;
const URL_TYPES = new Set(['website', 'url', 'web', 'webpage', 'sitemap', 'link']);
const GONE = new Set(['deleting', 'deleted']);

/** The key two documents are the same page by: lower-case scheme and host, no fragment, no trailing slash on the path. */
export function normUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return null;
  }
}

/** A readable name from the address: host and path, cut to the label limit. */
export function labelOf(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const text = `${u.host}${u.pathname}`.replace(/\/+$/, '');
    return (text || raw.trim()).slice(0, LABEL_MAX);
  } catch {
    return raw.trim().slice(0, LABEL_MAX);
  }
}

const isLive = (d: Doc): boolean =>
  !isDeleted(d) && !GONE.has((str(d.status) ?? '').toLowerCase());
const isUrlType = (d: Doc): boolean => {
  const t = (str(d.sourceType) ?? '').toLowerCase();
  return t === '' ? str(d.url) !== null : URL_TYPES.has(t);
};
/** The stored file name without any query string (a signed link would carry a token). */
const fileName = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const clean = s.split(/[?#]/)[0]!;
  return clean.split('/').pop() || clean;
};

const FIELDS = {
  _id: 'id',
  id: 'id',
  documentId: 'drop:id of the page inside the external vector store; the page is re-read by WaDesk, vectors are not copied',
  parentDocumentId: 'drop:id of the crawl parent in the vector store (no WaDesk equivalent)',
  sourceId: 'drop:id of the Waboo source (the crawl); WaDesk has one flat list of entries',
  sourceType: 'col:kind (website -> url); any other type is quarantined NEEDS_REUPLOAD (no bytes in the dump)',
  url: 'col:url and label (host + path, cut to 200 characters); duplicates of the same url are excluded DUPLICATE_URL',
  file_path: 'drop:path of the scraped copy in the Waboo store (not copied); for a file source only its name is listed (NEEDS_REUPLOAD)',
  characters: 'drop:size of the text in the vector store; tokens_estimate stays NULL until the page is read again',
  status: 'col:status (always failed + "Not fetched yet: re-ingest"); deleting / deleted documents are excluded SOFT_DELETED',
  sourceStatus: 'drop:Waboo upload state of the source',
  createdOn: 'col:created_at / updated_at',
  selected: 'drop:Waboo "use in answers" tick; WaDesk has none (a false value is the soft issue SELECTION_NOT_KEPT)',
  isbaseurl: 'drop:marks the root address of a crawl',
  botid: 'drop:the Waboo bot; entries are workspace-wide (assistant_id NULL), listed for every assistant',
  indexIds: 'drop:ids of the vectors in the external store (never copied)',
  [DUP_URL_MARK]: 'drop:stream marker of this step, not a Waboo field',
  is_deleted: 'drop:soft-delete flag; deleted documents are excluded',
  deleted_time: 'drop:soft-delete timestamp',
};

export const knowledgeSources: HandlerSpec = {
  handler: 'knowledge_sources',
  collection: 'document_col',
  mapCollection: 'document_col',
  tables: {
    ai_training_sources: {
      columns: [
        c('assistant_id', 'bigint'),
        c('user_id', 'bigint'),
        c('kind', 'text'),
        c('label', 'text'),
        c('url', 'text'),
        c('status', 'text'),
        c('error', 'text'),
        c('tokens_estimate', 'integer'),
        ...TS_COLS,
      ],
      fp: ['kind', 'label', 'url', 'status', 'error'],
      constants: { row_version: 1 },
      // what the app's worker settles once kb-reingest ran
      liveColumns: ['status', 'error', 'tokens_estimate', 'updated_at'],
    },
  },
  fields: FIELDS,
  /**
   * Marks the later documents of an address that an earlier live document already holds (earliest createdOn, then the smaller key wins),
   * so the transform of the loader and of the verifier agree. The stored file path loses any query string here, before a quarantine
   * copy of the document is written.
   */
  async *read({ source, client }) {
    if (!source.collections(client).includes('document_col')) return;
    const docs: Doc[] = [];
    for await (const d of source.read(client, 'document_col')) docs.push(d);
    const win = new Map<string, { at: number; key: string }>();
    for (const d of docs) {
      const n = isLive(d) && isUrlType(d) ? normUrl(str(d.url) ?? '') : null;
      if (!n) continue;
      const at = toDate(d.createdOn)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const key = primaryKey(d);
      const cur = win.get(n);
      if (!cur || at < cur.at || (at === cur.at && key < cur.key)) win.set(n, { at, key });
    }
    for (const d of docs) {
      const out: Doc = { ...d };
      if (typeof out.file_path === 'string') out.file_path = out.file_path.split(/[?#]/)[0]!;
      const n = isLive(d) && isUrlType(d) ? normUrl(str(d.url) ?? '') : null;
      if (n && win.get(n)!.key !== primaryKey(d)) out[DUP_URL_MARK] = true;
      yield out;
    }
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    if (isDeleted(doc) || GONE.has((str(doc.status) ?? '').toLowerCase()))
      return { kind: 'exclude', code: 'SOFT_DELETED', reason: 'the document is deleted or being deleted in Waboo' };
    if (doc[DUP_URL_MARK] === true)
      return { kind: 'exclude', code: 'DUPLICATE_URL', reason: 'an earlier document holds the same address: one entry per address' };
    if (!isUrlType(doc)) {
      const file = fileName(doc.file_path);
      return {
        kind: 'quarantine',
        code: 'NEEDS_REUPLOAD',
        reason: `a "${str(doc.sourceType)}" source has no file bytes in the dump: upload ${file ?? 'the file'} again in WaDesk (Knowledge)`,
        detail: { sourceType: str(doc.sourceType), file },
      };
    }
    const raw = str(doc.url);
    if (!raw) return { kind: 'quarantine', code: 'NO_URL', reason: 'a website source without an address' };
    if (raw.length > URL_MAX || normUrl(raw) === null)
      return { kind: 'quarantine', code: 'INVALID_URL', reason: 'the address is not an http(s) URL of at most 1024 characters' };

    const t = times(doc, ctx.fallbackAt, ['createdOn'], []);
    const soft: Soft[] = [...t.soft];
    if (doc.selected === false)
      soft.push({ code: 'SELECTION_NOT_KEPT', reason: 'the page was not ticked for answers in Waboo; WaDesk has no such tick' });
    return {
      kind: 'rows',
      soft,
      rows: [
        {
          table: 'ai_training_sources',
          sub: '',
          row: {
            assistant_id: null,
            user_id: null,
            kind: 'url',
            label: labelOf(raw),
            url: raw.trim(),
            status: 'failed',
            error: NOT_FETCHED,
            tokens_estimate: null,
            created_at: t.created,
            updated_at: t.updated,
          },
        },
      ],
    };
  },
};

