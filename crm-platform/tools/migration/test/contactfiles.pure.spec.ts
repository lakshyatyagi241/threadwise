import { describe, expect, it } from 'vitest';
import { cleanFileName, contactFiles, readWithAttachments } from '../transform/contactfiles';
import { REGISTRY } from '../registry';
import { STEPS } from '../transform';
import { STEP_DEPS } from '../load/steps';
import type { Ctx } from '../transform/types';

const contact = { table: 'contacts', id: 7, uuid: 'u' };
const ctx = (over: Partial<{ deleted: boolean; refs: boolean }> = {}) =>
  ({
    fallbackAt: '2026-06-01T00:00:00.000Z',
    idx: { hasUsers: true, contactDeleted: new Set(over.deleted ? ['c1'] : []) },
    ref: (coll: string, key: unknown) =>
      coll === 'contact_list' && key === 'c1' && over.refs !== false ? contact : coll === 'user' && key === 'u1' ? { table: 'users', id: 3, uuid: 'x' } : undefined,
  }) as unknown as Ctx;
const base = {
  _id: 'f1',
  id: 'f1',
  contact_id: 'c1',
  file_name: 'Quote.pdf',
  file_size: '12.3 KB',
  file_type: '.pdf',
  created_by: 'u1',
  uploaded_at: new Date('2026-04-08T10:00:00Z'),
  downloads: 2,
  is_deleted: false,
};
const att = { source: 'https://files.example.test/uploads/quote.pdf', file_size: 12595, is_deleted: false, deleted_time: null };
const out = (d: object, c = ctx()) => contactFiles.transform(d as never, c) as any;

describe('contact_files', () => {
  it('loads with the Waboo address as storage_key (copy-files converts it), the exact size, the user and the upload date', () => {
    const o = out({ ...base, _attachment: att });
    expect(o.kind).toBe('rows');
    expect(o.rows[0].table).toBe('contact_files');
    expect(o.rows[0].row).toEqual({
      contact_id: 7,
      file_name: 'Quote.pdf',
      file_size_bytes: 12595,
      storage_key: att.source,
      uploaded_by: 3,
      created_at: '2026-04-08T10:00:00.000Z',
    });
    expect(o.soft).toEqual([]);
  });
  it('never turns the rounded display size into bytes', () => {
    expect(out({ ...base, _attachment: { ...att, file_size: undefined } }).rows[0].row.file_size_bytes).toBeNull();
  });
  it('a file with no address in the dump, or a non-http address, is quarantined (nothing to copy)', () => {
    expect(out(base)).toMatchObject({ kind: 'quarantine', code: 'NO_FILE_URL' });
    expect(out({ ...base, _attachment: { ...att, source: 'C:/uploads/quote.pdf' } })).toMatchObject({ code: 'NO_FILE_URL' });
    expect(out({ ...base, _attachment: { ...att, source: null } })).toMatchObject({ code: 'NO_FILE_URL' });
  });
  it('excludes soft-deleted files and files of deleted contacts; quarantines an unknown contact', () => {
    expect(out({ ...base, is_deleted: true, _attachment: att })).toMatchObject({ kind: 'exclude', code: 'SOFT_DELETED' });
    expect(out({ ...base, _attachment: { ...att, is_deleted: true } })).toMatchObject({ kind: 'exclude', code: 'SOFT_DELETED' });
    expect(out({ ...base, _attachment: att }, ctx({ refs: false, deleted: true }))).toMatchObject({ kind: 'exclude', code: 'PARENT_EXCLUDED' });
    expect(out({ ...base, _attachment: att }, ctx({ refs: false }))).toMatchObject({ kind: 'quarantine', code: 'ORPHAN_CONTACT' });
  });
  it('cleans a name to the WaDesk contract and says so; keeps a query string visible as a soft issue', () => {
    const o = out({ ...base, file_name: 'a/b\\c.pdf', _attachment: { ...att, source: `${att.source}?sig=1` } });
    expect(o.rows[0].row.file_name).toBe('a_b_c.pdf');
    expect(o.soft.map((s: { code: string }) => s.code).sort()).toEqual(['FILE_NAME_CLEANED', 'URL_QUERY_KEPT']);
    expect(cleanFileName('..')).toBe('');
    expect(cleanFileName('x'.repeat(300))).toHaveLength(255);
  });
  it('an unresolved uploader leaves uploaded_by empty with a soft issue', () => {
    const o = out({ ...base, created_by: 'nobody', _attachment: att });
    expect(o.rows[0].row.uploaded_by).toBeNull();
    expect(o.soft.map((s: { code: string }) => s.code)).toEqual(['UNRESOLVED_USER']);
  });
  it('reads the attachments row with the SAME id, nothing else', async () => {
    const docs: Record<string, object[]> = {
      contact_files: [base, { ...base, _id: 'f2', id: 'f2' }],
      attachments: [{ id: 'f1', source: att.source, file_size: 5, name: 'zzz', secret: 'x' }, { id: 'other', source: 'https://x.test/y' }],
    };
    const source = {
      collections: () => Object.keys(docs),
      read: async function* (_c: string, coll: string) {
        yield* docs[coll]!;
      },
    };
    const got: any[] = [];
    for await (const d of readWithAttachments({ source: source as never, client: 'x' })) got.push(d);
    expect(got[0]._attachment).toEqual({ source: att.source, file_size: 5, is_deleted: undefined, deleted_time: undefined });
    expect(got[1]._attachment).toBeUndefined();
  });
  it('is registered: MIGRATE with a handler, a step after contacts, depends on contacts', () => {
    const e = REGISTRY.find((r) => r.collection === 'contact_files')!;
    expect(e).toMatchObject({ disposition: 'MIGRATE', handler: 'contact_files' });
    const at = (h: string) => STEPS.findIndex((s) => s.handler === h);
    expect(at('contact_files')).toBeGreaterThan(at('contacts'));
    expect(STEP_DEPS.contact_files).toContain('contacts');
  });
});
