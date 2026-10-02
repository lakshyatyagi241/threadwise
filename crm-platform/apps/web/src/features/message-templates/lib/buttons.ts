import type { TplButton } from '@crm/contracts';
import { countPlaceholders } from './variables';

export type ButtonKind = 'quick_reply' | 'url' | 'phone' | 'copy_code' | 'other';
/** The kinds an operator can add. `other` is a stored button this editor does not author (it is kept as it is). */
export const ADDABLE_KINDS = ['quick_reply', 'url', 'phone', 'copy_code'] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

/** Meta's limits per template (the server linter enforces the same). */
export const BUTTON_LIMITS = {
  total: 10,
  quick_reply: 10,
  url: 2,
  phone: 1,
  copy_code: 1,
} as const;
export const BUTTON_TEXT_MAX = 25;

export interface ButtonRow {
  /** Client-only identity for React keys and focus. Never sent. */
  key: string;
  kind: ButtonKind;
  text: string;
  url: string;
  phone: string;
  /** Sample for a URL with a variable, or the coupon code of a copy-code button. */
  example: string;
  /** A stored button of a type this editor does not author, round-tripped unchanged. */
  raw?: TplButton;
}

let seq = 0;
export const nextKey = (): string => `b${++seq}`;

export function newRow(kind: AddableKind, key = nextKey()): ButtonRow {
  return { key, kind, text: '', url: '', phone: '', example: '' };
}

export const count = (rows: ButtonRow[], kind: ButtonKind): number =>
  rows.filter((r) => r.kind === kind).length;

/** Whether one more button of this kind fits under Meta's limits. */
export function canAdd(rows: ButtonRow[], kind: AddableKind): boolean {
  return rows.length < BUTTON_LIMITS.total && count(rows, kind) < BUTTON_LIMITS[kind];
}

export const addableKinds = (rows: ButtonRow[]): AddableKind[] =>
  ADDABLE_KINDS.filter((k) => canAdd(rows, k));

const TYPE_OF: Record<AddableKind, string> = {
  quick_reply: 'QUICK_REPLY',
  url: 'URL',
  phone: 'PHONE_NUMBER',
  copy_code: 'COPY_CODE',
};

export function rowToButton(r: ButtonRow): TplButton {
  if (r.kind === 'other' && r.raw) return r.raw;
  const kind = r.kind === 'other' ? 'quick_reply' : r.kind;
  const b: TplButton = { type: TYPE_OF[kind] };
  if (kind === 'copy_code') {
    b.example = r.example.trim();
    return b;
  }
  b.text = r.text.trim();
  if (kind === 'url') {
    b.url = r.url.trim();
    if (countPlaceholders(r.url) > 0 && r.example.trim()) b.example = r.example.trim();
  }
  if (kind === 'phone') b.phone_number = r.phone.trim();
  return b;
}

export function buttonToRow(b: TplButton, key = nextKey()): ButtonRow {
  const base: ButtonRow = {
    key,
    kind: 'other',
    text: b.text ?? '',
    url: b.url ?? '',
    phone: b.phone_number ?? '',
    example: Array.isArray(b.example) ? (b.example[0] ?? '') : (b.example ?? ''),
    raw: b,
  };
  switch (b.type.toUpperCase()) {
    case 'QUICK_REPLY':
      return { ...base, kind: 'quick_reply', raw: undefined };
    case 'URL':
      return { ...base, kind: 'url', raw: undefined };
    case 'PHONE_NUMBER':
      return { ...base, kind: 'phone', raw: undefined };
    case 'COPY_CODE':
      return { ...base, kind: 'copy_code', raw: undefined };
    default:
      return base;
  }
}

export type ButtonIssueCode =
  | 'textRequired'
  | 'textTooLong'
  | 'urlRequired'
  | 'urlInvalid'
  | 'phoneRequired'
  | 'codeRequired'
  | 'quickReplyVariable'
  | 'urlExampleRequired'
  | 'quickReplyPosition';

export interface ButtonIssue {
  /** The row it belongs to, or null for a problem of the whole list. */
  rowKey: string | null;
  code: ButtonIssueCode;
}

/** Instant checks while editing. The server linter stays the authority; these only point at the row. */
export function buttonIssues(rows: ButtonRow[]): ButtonIssue[] {
  const out: ButtonIssue[] = [];
  for (const r of rows) {
    if (r.kind === 'other') continue;
    if (r.kind !== 'copy_code') {
      if (!r.text.trim()) out.push({ rowKey: r.key, code: 'textRequired' });
      else if (r.text.trim().length > BUTTON_TEXT_MAX)
        out.push({ rowKey: r.key, code: 'textTooLong' });
    }
    if (r.kind === 'quick_reply' && /\{\{[^}]+\}\}/.test(r.text))
      out.push({ rowKey: r.key, code: 'quickReplyVariable' });
    if (r.kind === 'url') {
      if (!r.url.trim()) out.push({ rowKey: r.key, code: 'urlRequired' });
      else if (!/^https?:\/\//i.test(r.url.trim())) out.push({ rowKey: r.key, code: 'urlInvalid' });
      else if (countPlaceholders(r.url) > 0 && !r.example.trim())
        out.push({ rowKey: r.key, code: 'urlExampleRequired' });
    }
    if (r.kind === 'phone' && !r.phone.trim()) out.push({ rowKey: r.key, code: 'phoneRequired' });
    if (r.kind === 'copy_code' && !r.example.trim()) out.push({ rowKey: r.key, code: 'codeRequired' });
  }
  const qr = rows.map((r) => r.kind === 'quick_reply');
  const first = qr.indexOf(true);
  const last = qr.lastIndexOf(true);
  if (first >= 0 && (qr.slice(first, last + 1).includes(false) || (first > 0 && last < qr.length - 1)))
    out.push({ rowKey: null, code: 'quickReplyPosition' });
  return out;
}

export function moveRow(rows: ButtonRow[], from: number, to: number): ButtonRow[] {
  if (to < 0 || to >= rows.length || from === to) return rows;
  const next = rows.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
