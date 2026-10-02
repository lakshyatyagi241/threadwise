import { findField, type FieldDef } from './fields';
import type { Condition, EditorValue, Group, RuleNode } from './model';
import { inputKindOf } from './operators';

/**
 * The rules as one plain sentence ("Stage is Qualified and Tags include any of VIP, Hot"). Pure: the words come from
 * `t`, so the same function serves the English and Arabic messages and the tests (which pass a fake translator).
 *
 * Message keys used (under the feature's `summary` namespace): `and`, `or`, `deleted`, `unknownField`, `more`,
 * `group` ("({rules})"), `empty`, and one `op.<operator>` per operator (plus `op.equals_date`) taking `field`, `value`, `from`, `to`, `days`.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface SummaryContext {
  catalog: readonly FieldDef[];
  t: Translate;
  /** Field label (system fields are translated by the caller). */
  fieldLabel: (field: FieldDef) => string;
  /** Formats an ISO date (`2026-03-01`) for the reader; defaults to the ISO text. */
  formatDate?: (iso: string) => string;
  /** Values of a list shown before "+N more". */
  maxListed?: number;
}

function valueText(c: Condition, field: FieldDef | undefined, ctx: SummaryContext): string {
  const v: EditorValue = c.value;
  const date = (s: string) => ctx.formatDate?.(s) ?? s;
  const kind = field?.kind;
  const labelOf = (raw: string) => {
    if (!field?.options) return raw;
    return field.options.find((o) => o.value === raw)?.label ?? ctx.t('deleted');
  };
  // a condition still being filled in reads "Stage is …"
  if (v === '' || (Array.isArray(v) && v.length === 0)) return '…';
  if (Array.isArray(v)) {
    const max = ctx.maxListed ?? 4;
    const shown = v.slice(0, max).map(labelOf);
    const rest = v.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} ${ctx.t('more', { count: rest })}` : shown.join(', ');
  }
  if (typeof v === 'string') {
    if (kind === 'date') return date(v);
    if (field?.options) return labelOf(v);
    return v;
  }
  return '';
}

/** The message key of an operator's phrase; "equals" on a date reads "is on". */
export function operatorKey(kind: string | undefined, operator: string): string {
  return kind === 'date' && operator === 'equals' ? 'op.equals_date' : `op.${operator}`;
}

function conditionText(c: Condition, ctx: SummaryContext): string {
  const field = findField(ctx.catalog, c.field);
  const name = field ? ctx.fieldLabel(field) : ctx.t('unknownField');
  const base = { field: name };
  const shape = field ? inputKindOf(field.kind, c.operator) : 'none';
  const key = operatorKey(field?.kind, c.operator);
  const v = c.value;
  if (shape === 'numberRange' || shape === 'dateRange') {
    const r = typeof v === 'object' && v !== null && !Array.isArray(v) ? v : { from: '', to: '' };
    const fmt = (s: string) => (shape === 'dateRange' ? (ctx.formatDate?.(s) ?? s) : s);
    return ctx.t(key, { ...base, from: fmt(r.from), to: fmt(r.to) });
  }
  if (shape === 'days') {
    return ctx.t(key, { ...base, days: typeof v === 'string' ? Number(v) || 0 : 0 });
  }
  return ctx.t(key, { ...base, value: valueText(c, field, ctx) });
}

function nodeText(node: RuleNode, ctx: SummaryContext, nested: boolean): string {
  if (node.kind === 'condition') return conditionText(node, ctx);
  const parts = node.children.map((c) => nodeText(c, ctx, true)).filter((s) => s !== '');
  if (parts.length === 0) return '';
  const joined = parts.join(` ${ctx.t(node.combinator)} `);
  return nested && parts.length > 1 ? ctx.t('group', { rules: joined }) : joined;
}

/** "Stage is Qualified and (Tags include any of VIP or Source contains web)"; the empty string for no conditions. */
export function summarize(root: Group, ctx: SummaryContext): string {
  return nodeText(root, ctx, false);
}

/** The conditions of a tree as short sentences, for a row of a table or a tooltip. */
export function summarizeConditions(root: Group, ctx: SummaryContext): string[] {
  return root.children.map((c) => nodeText(c, ctx, false)).filter((s) => s !== '');
}
