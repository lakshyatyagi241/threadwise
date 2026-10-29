import { describe, expect, it } from 'vitest';
import { headerLinks, headerSampleOf, templates } from '../transform/templates';
import type { Ctx, Outcome } from '../transform/types';
import type { Source } from '../extract/source';

const HANDLE = 'https://scontent.whatsapp.net/v/t61/abc/header.jpg?oh=signed&oe=1';
const tpl = (header: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  id: 'TPL_1',
  name: 'goldfinal',
  category: 'MARKETING',
  language: 'en',
  status: 'APPROVED',
  meta_template_id: '1979408912740244',
  created_time: '2026-09-01T10:00:00Z',
  modified_time: '2026-10-21T10:00:00Z',
  components: [...(header ? [header] : []), { type: 'BODY', text: 'Hello' }],
  ...over,
});
const image = (handles: unknown) => ({
  type: 'HEADER',
  format: 'IMAGE',
  example: { header_handle: handles },
});
const ctx = {
  fallbackAt: '2026-06-01T00:00:00.000Z',
  ref: () => undefined,
  idx: {},
} as unknown as Ctx;
const rowOf = (o: Outcome) => {
  if (o.kind !== 'rows') throw new Error(`expected rows, got ${o.kind}`);
  return o.rows[0]!.row;
};

describe('the Meta link of a template header file', () => {
  it('is read from the example handle of an image, video or document header', () => {
    expect(headerSampleOf(tpl(image([HANDLE])))).toBe(HANDLE);
    expect(headerSampleOf(tpl({ ...image([HANDLE]), format: 'VIDEO' }))).toBe(HANDLE);
    expect(headerSampleOf(tpl({ ...image([HANDLE]), format: 'DOCUMENT' }))).toBe(HANDLE);
  });
  it('is none for a text header, a location, no header, no handle or an address that is not https', () => {
    expect(headerSampleOf(tpl({ type: 'HEADER', format: 'TEXT', text: 'Hi' }))).toBeNull();
    expect(headerSampleOf(tpl({ type: 'HEADER', format: 'LOCATION' }))).toBeNull();
    expect(headerSampleOf(tpl(null))).toBeNull();
    expect(headerSampleOf(tpl(image([])))).toBeNull();
    expect(headerSampleOf(tpl(image(['http://example.com/a.jpg'])))).toBeNull();
    expect(headerSampleOf(tpl(image(['file:///etc/passwd'])))).toBeNull();
    expect(headerSampleOf({ id: 'x' })).toBeNull();
  });
});

describe('the templates handler', () => {
  it('keeps the link of a media header as header_sample_url, and the template stays a media template', () => {
    const row = rowOf(templates.transform(tpl(image([HANDLE])) as never, ctx));
    expect(row).toMatchObject({
      attachment_type: 'image',
      template_type: 'media',
      header_sample_url: HANDLE,
    });
  });
  it('has no link for a text header', () => {
    const row = rowOf(
      templates.transform(tpl({ type: 'HEADER', format: 'TEXT', text: 'Hi' }) as never, ctx),
    );
    expect(row).toMatchObject({ attachment_type: null, header_sample_url: null });
  });
});

describe('template-headers: the links of the dump', () => {
  it('maps every key a template answers to onto its link, and skips templates with none', async () => {
    const docs = [
      tpl(image([HANDLE])),
      tpl(null, { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', id: 'TPL_2' }),
    ];
    const source = {
      collections: () => ['broadcast_templates'],
      async *read() {
        for (const d of docs) yield d;
      },
    } as unknown as Source;
    const m = await headerLinks(source, 'acme');
    expect([...m.keys()].sort()).toEqual(['TPL_1', 'aaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(m.get('TPL_1')).toBe(HANDLE);
    const none = { collections: () => [] } as unknown as Source;
    expect((await headerLinks(none, 'acme')).size).toBe(0);
  });
});
