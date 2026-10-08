import { describe, expect, it } from 'vitest';
import { reportSpecSchema } from '@crm/contracts';
import {
  activeItem,
  activeSpec,
  emptyCanvas,
  withActive,
  withDesigned,
  withDesignedActive,
  withBlock,
  withDrawn,
  type ReportMeta,
} from './canvas';

const META: ReportMeta = { prompt: 'p', generatedAt: 1, documents: 0 };
const draw = (c: ReturnType<typeof emptyCanvas>, d: Parameters<typeof withDrawn>[1]) =>
  withDrawn(c, d, META);
const spec = (title: string) =>
  reportSpecSchema.parse({ title, summary: '', sections: [{ heading: 'H', body: 'b' }] });
const titles = (c: ReturnType<typeof emptyCanvas>) =>
  c.items.map((i) =>
    i.kind === 'spec'
      ? i.spec.title
      : i.kind === 'blocks'
        ? `blocks:${i.turn}`
        : `designed:${i.id}`,
  );

describe('canvas', () => {
  it('starts empty', () => {
    expect(activeItem(emptyCanvas())).toBeNull();
    expect(activeSpec(emptyCanvas())).toBeNull();
  });

  it('puts each new report on show at once and keeps the earlier ones', () => {
    let c = draw(emptyCanvas(), { ok: true, spec: spec('One') });
    expect(activeSpec(c)?.title).toBe('One');
    c = draw(c, { ok: true, spec: spec('Two') });
    expect(titles(c)).toEqual(['One', 'Two']);
    expect(activeSpec(c)?.title).toBe('Two');
  });

  it('switches back to an earlier report, and ignores an index outside the list', () => {
    let c = draw(emptyCanvas(), { ok: true, spec: spec('One') });
    c = draw(c, { ok: true, spec: spec('Two') });
    c = withActive(c, 0);
    expect(activeSpec(c)?.title).toBe('One');
    expect(withActive(c, 5)).toBe(c);
    expect(withActive(c, -1)).toBe(c);
    expect(withActive(c, Number.NaN)).toBe(c);
  });

  it('keeps the report on show when a later one cannot be drawn, and clears the issues on the next good one', () => {
    let c = draw(emptyCanvas(), { ok: true, spec: spec('One') });
    c = draw(c, { ok: false, issues: ['title: Required'] });
    expect(activeSpec(c)?.title).toBe('One');
    expect(c.issues).toEqual(['title: Required']);
    c = draw(c, { ok: true, spec: spec('Two') });
    expect(c.issues).toBeNull();
  });
});

describe('canvas with designed reports', () => {
  it('lists a designed report beside the structured ones and puts it on show when it first appears', () => {
    let c = draw(emptyCanvas(), { ok: true, spec: spec('One') });
    c = withDesigned(c, 'm1', { generating: true, html: ['<p>'] });
    expect(titles(c)).toEqual(['One', 'designed:m1']);
    expect(activeItem(c)?.kind).toBe('designed');
    expect(activeSpec(c)).toBeNull();
  });

  it('updates a designed report in place as it streams, without taking the focus back', () => {
    let c = withDesigned(emptyCanvas(), 'm1', { generating: true, html: ['<p>'] });
    c = draw(c, { ok: true, spec: spec('Two') });
    c = withDesigned(c, 'm1', { generating: false, htmlComplete: true, html: ['<p>done</p>'] });
    expect(c.items).toHaveLength(2);
    expect(activeSpec(c)?.title).toBe('Two');
    const first = c.items[0]!;
    expect(first.kind === 'designed' && first.content.htmlComplete).toBe(true);
  });

  it('returns the same object for the same content again, so a re-render cannot loop', () => {
    const c = withDesigned(emptyCanvas(), 'm1', { generating: true, html: ['<p>'] });
    expect(withDesigned(c, 'm1', { generating: true, html: ['<p>'] })).toBe(c);
  });

  it('brings a designed report back on show by id, and ignores an unknown id', () => {
    let c = withDesigned(emptyCanvas(), 'm1', { html: ['a'] });
    c = draw(c, { ok: true, spec: spec('Two') });
    expect(withDesignedActive(c, 'm1').active).toBe(0);
    expect(withDesignedActive(c, 'nope')).toBe(c);
  });
});

describe('canvas with blocks', () => {
  const block = (id: string) =>
    ({ id, tool: 'show_summary', data: { markdown: id } }) as Parameters<typeof withBlock>[2];

  it('makes one report of the blocks of a turn, in the order they were shown, and puts it on show', () => {
    let c = withBlock(emptyCanvas(), '1', block('a'), META);
    c = withBlock(c, '1', block('b'), META);
    expect(c.items).toHaveLength(1);
    const item = c.items[0]!;
    expect(item.kind === 'blocks' && item.blocks.map((b) => b.id)).toEqual(['a', 'b']);
    expect(c.active).toBe(0);
  });

  it('starts a new report for a new turn and keeps the earlier one in the list', () => {
    let c = withBlock(emptyCanvas(), '1', block('a'), META);
    c = withBlock(c, '2', block('b'), META);
    expect(titles(c)).toEqual(['blocks:1', 'blocks:2']);
    expect(c.active).toBe(1);
  });

  it('keeps a replayed block once, and returns the same object so nothing re-renders', () => {
    const c = withBlock(emptyCanvas(), '1', block('a'), META);
    expect(withBlock(c, '1', block('a'), META)).toBe(c);
  });

  it('keeps a block the model sent twice in a row once', () => {
    let c = withBlock(emptyCanvas(), '1', block('same'), META);
    const again = { ...block('same'), id: 'other-call' };
    c = withBlock(c, '1', again, META);
    const item = c.items[0]!;
    expect(item.kind === 'blocks' && item.blocks).toHaveLength(1);
  });

  it('adds a block to its own turn without taking the focus from the report on show', () => {
    let c = withBlock(emptyCanvas(), '1', block('a'), META);
    c = withBlock(c, '2', block('x'), META);
    c = withActive(c, 0);
    c = withBlock(c, '2', block('y'), META);
    expect(c.active).toBe(0);
  });
});
