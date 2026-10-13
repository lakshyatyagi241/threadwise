import { describe, expect, it } from 'vitest';
import { planReingest } from '../load/kbreingest';
import { knowledgeSources, labelOf, normUrl, NOT_FETCHED } from '../transform/knowledge';
import { REGISTRY } from '../registry';
import { STEPS, transformDoc } from '../transform';
import { Oid, type Doc } from '../util';
import type { Source } from '../extract/source';
import type { Ctx } from '../transform/types';

const oid = (n: number): Oid => new Oid(n.toString(16).padStart(24, '0'));
const doc = (n: number, extra: Doc = {}): Doc => ({
  _id: oid(n),
  documentId: `d${n}`,
  parentDocumentId: 'p',
  sourceId: 's',
  sourceType: 'website',
  url: `https://shop.example.test/page-${n}`,
  file_path: `store/doc-${n}.txt?sig=SECRET`,
  characters: 100,
  status: 'uploaded',
  createdOn: new Date(Date.UTC(2026, 3, n)),
  ...extra,
});
const source = (docs: Doc[]): Source =>
  ({
    collections: () => ['document_col'],
    read: async function* () {
      yield* docs;
    },
  }) as unknown as Source;
const ctx = { fallbackAt: '2026-06-01T00:00:00.000Z' } as unknown as Ctx;
const stream = async (docs: Doc[]): Promise<Doc[]> => {
  const out: Doc[] = [];
  for await (const d of knowledgeSources.read!({ source: source(docs), client: 'acme', idx: undefined as never }))
    out.push(d);
  return out;
};

describe('knowledge_sources', () => {
  it('is registered, and is a step', () => {
    expect(REGISTRY.find((e) => e.collection === 'document_col')?.handler).toBe('knowledge_sources');
    expect(STEPS.some((s) => s.handler === 'knowledge_sources')).toBe(true);
  });

  it('a website document becomes a failed, not-fetched url entry (workspace-wide, no content)', () => {
    const out = transformDoc(knowledgeSources, doc(1), ctx);
    expect(out.kind).toBe('rows');
    if (out.kind !== 'rows') return;
    const row = out.rows[0]!.row;
    expect(out.rows[0]!.table).toBe('ai_training_sources');
    expect(row).toMatchObject({
      assistant_id: null,
      kind: 'url',
      url: 'https://shop.example.test/page-1',
      label: 'shop.example.test/page-1',
      status: 'failed',
      error: NOT_FETCHED,
      tokens_estimate: null,
      created_at: '2026-04-01T00:00:00.000Z',
    });
    expect(row).not.toHaveProperty('content');
  });

  it('every column in the row is declared and every source key has a fields entry', () => {
    const out = transformDoc(knowledgeSources, doc(1, { botid: 'b', selected: true, isbaseurl: false, indexIds: ['x'], sourceStatus: 'uploaded' }), ctx);
    if (out.kind !== 'rows') throw new Error('rows expected');
    const cols = new Set(knowledgeSources.tables.ai_training_sources!.columns.map((c) => c.name));
    for (const k of Object.keys(out.rows[0]!.row)) expect(cols.has(k)).toBe(true);
    for (const k of Object.keys(doc(1, { botid: 'b', selected: true, isbaseurl: false, indexIds: ['x'], sourceStatus: 'uploaded' })))
      expect(knowledgeSources.fields).toHaveProperty(k);
  });

  it('deleting / deleted documents are excluded, a file source is quarantined with its file name (no query string)', async () => {
    expect(transformDoc(knowledgeSources, doc(1, { status: 'deleting' }), ctx)).toMatchObject({ kind: 'exclude', code: 'SOFT_DELETED' });
    const [pdf] = await stream([doc(2, { sourceType: 'pdf', url: undefined, file_path: 'a/b/price-list.pdf?sig=SECRET' })]);
    const out = transformDoc(knowledgeSources, pdf!, ctx);
    expect(out).toMatchObject({ kind: 'quarantine', code: 'NEEDS_REUPLOAD', detail: { file: 'price-list.pdf' } });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });

  it('a bad or missing address is quarantined, a long label is cut to 200', () => {
    expect(transformDoc(knowledgeSources, doc(1, { url: 'ftp://x.test/a' }), ctx)).toMatchObject({ code: 'INVALID_URL' });
    expect(transformDoc(knowledgeSources, doc(1, { url: '' }), ctx)).toMatchObject({ code: 'NO_URL' });
    expect(labelOf(`https://a.test/${'x'.repeat(500)}`).length).toBe(200);
  });

  it('the same address is loaded once: the earliest document wins, the rest are DUPLICATE_URL', async () => {
    const docs = [
      doc(3, { url: 'https://Shop.example.test/a/#top' }),
      doc(1, { url: 'https://shop.example.test/a' }),
      doc(2, { url: 'https://shop.example.test/a/', status: 'deleting' }),
    ];
    const seen = await stream(docs);
    const kinds = seen.map((d) => transformDoc(knowledgeSources, d, ctx).kind);
    expect(kinds).toEqual(['exclude', 'rows', 'exclude']);
    expect(transformDoc(knowledgeSources, seen[0]!, ctx)).toMatchObject({ code: 'DUPLICATE_URL' });
    // deterministic: the same input in another order picks the same winner
    const again = await stream([...docs].reverse());
    expect(again.filter((d) => transformDoc(knowledgeSources, d, ctx).kind === 'rows').map((d) => String(d._id))).toEqual([String(oid(1))]);
    expect(normUrl('https://Shop.example.test/a/#top')).toBe(normUrl('https://shop.example.test/a'));
  });
});

describe('kb-reingest plan', () => {
  it('resets only failed entries with an address; ready and processing get no second event', () => {
    const p = planReingest([
      { id: 1, status: 'failed', url: 'https://a.test/' },
      { id: 2, status: 'ready', url: 'https://a.test/2' },
      { id: 3, status: 'processing', url: 'https://a.test/3' },
      { id: 4, status: 'failed', url: null },
    ]);
    expect(p).toEqual({ reset: [1], ready: 1, processing: 1, noUrl: 1 });
    // after a run the entry is processing: the same call plans nothing
    expect(planReingest([{ id: 1, status: 'processing', url: 'https://a.test/' }]).reset).toEqual([]);
  });
});
