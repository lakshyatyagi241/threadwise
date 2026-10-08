import type { ReportSpec } from '@crm/contracts';
import { sameBlock, type Block } from './blocks';
import { designedSignature, type DesignedContent } from './designed-report';

/** When and from what a report was made, and the request that asked for it (so "Refresh data" can ask again). */
export interface ReportMeta {
  /** The person's message that led to the report, or null when it cannot be told. */
  prompt: string | null;
  /** Milliseconds since the epoch. */
  generatedAt: number;
  /** Ready documents in the library at that moment. */
  documents: number;
}

/**
 * One report on the page: a run of blocks the assistant showed (the default), one structured `ReportSpec`, or one the model designed
 * (a sandboxed page, only when asked for).
 */
export type ReportItem =
  | { kind: 'blocks'; turn: string; blocks: Block[]; meta: ReportMeta }
  | { kind: 'spec'; spec: ReportSpec; meta: ReportMeta }
  | { kind: 'designed'; id: string; content: DesignedContent; sig: string };

/**
 * The reports drawn on the Reports page since it opened, newest last, and the one on show. They live in page state only (nothing is
 * saved): leaving the page clears them. A report that cannot be drawn leaves the list as it was and carries its issues.
 */
export interface Canvas {
  items: ReportItem[];
  active: number;
  issues: string[] | null;
}

export type Drawn = { ok: true; spec: ReportSpec } | { ok: false; issues: string[] };

export const emptyCanvas = (): Canvas => ({ items: [], active: 0, issues: null });

/** A new report goes on show at once; a failed one keeps what was there and shows why. */
export function withDrawn(c: Canvas, d: Drawn, meta: ReportMeta): Canvas {
  return d.ok
    ? {
        items: [...c.items, { kind: 'spec', spec: d.spec, meta }],
        active: c.items.length,
        issues: null,
      }
    : { ...c, issues: d.issues };
}

/**
 * A block the assistant showed. Blocks of one turn (one question and its answer) make one report: the first adds it and puts it on
 * show, the rest are appended in order. The same block twice (a replayed call, or one the model sent again word for word) is kept once.
 */
export function withBlock(c: Canvas, turn: string, block: Block, meta: ReportMeta): Canvas {
  const at = c.items.findIndex((i) => i.kind === 'blocks' && i.turn === turn);
  if (at === -1)
    return {
      items: [...c.items, { kind: 'blocks', turn, blocks: [block], meta }],
      active: c.items.length,
      issues: null,
    };
  const item = c.items[at]!;
  if (item.kind !== 'blocks' || item.blocks.some((b) => b.id === block.id || sameBlock(b, block)))
    return c;
  const items = c.items.slice();
  items[at] = { ...item, blocks: [...item.blocks, block] };
  return { ...c, items };
}

/** The meta of the report on show, if it has one a refresh can use. */
export function activeMeta(c: Canvas): ReportMeta | null {
  const i = activeItem(c);
  return i && i.kind !== 'designed' ? i.meta : null;
}

/**
 * A designed report arrives piece by piece under one id: the first piece adds it and puts it on show, later pieces update it in
 * place without taking the focus back. The same content again changes nothing (and returns the same object, so no re-render).
 */
export function withDesigned(c: Canvas, id: string, content: DesignedContent): Canvas {
  const sig = designedSignature(content);
  const at = c.items.findIndex((i) => i.kind === 'designed' && i.id === id);
  if (at === -1)
    return {
      items: [...c.items, { kind: 'designed', id, content, sig }],
      active: c.items.length,
      issues: null,
    };
  const item = c.items[at]!;
  if (item.kind === 'designed' && item.sig === sig) return c;
  const items = c.items.slice();
  items[at] = { kind: 'designed', id, content, sig };
  return { ...c, items };
}

/** Put an earlier report on show; an index outside the list changes nothing. */
export function withActive(c: Canvas, index: number): Canvas {
  return Number.isInteger(index) && index >= 0 && index < c.items.length
    ? { ...c, active: index, issues: null }
    : c;
}

/** Put the designed report with this id on show (the chat card's "Show report"). */
export function withDesignedActive(c: Canvas, id: string): Canvas {
  const at = c.items.findIndex((i) => i.kind === 'designed' && i.id === id);
  return at === -1 ? c : withActive(c, at);
}

export const activeItem = (c: Canvas): ReportItem | null => c.items[c.active] ?? null;

/** The structured report on show, for the print copy: only a structured report has one. */
export function activeSpec(c: Canvas): ReportSpec | null {
  const i = activeItem(c);
  return i?.kind === 'spec' ? i.spec : null;
}
