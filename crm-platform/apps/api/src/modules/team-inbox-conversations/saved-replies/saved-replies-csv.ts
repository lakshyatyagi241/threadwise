import {
  SAVED_REPLY_BODY_MAX,
  SAVED_REPLY_CATEGORY_MAX,
  SAVED_REPLY_CSV_COLUMNS,
  SAVED_REPLY_TITLE_MAX,
  channelKindSchema,
  normalizeShortcut,
  type SavedReplyImportIssue,
} from '@crm/contracts';

/** A cell a spreadsheet will not run as a formula: a leading `= + - @` (or tab / CR) gets an apostrophe in front. */
export const guardFormula = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** The import undoes the export's guard, so a reply that starts with `-` survives a round trip. */
export const unguardFormula = (v: string): string => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);

function cell(value: string | null | undefined): string {
  const text = guardFormula(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface ExportReply {
  title: string;
  shortcut: string;
  body: string;
  category: string | null;
  language: string | null;
  channelKinds: readonly string[];
}

/** The library as CSV: title, shortcut, body, category, language, channel (kinds joined with `|`; empty = every channel). */
export function savedRepliesCsv(rows: readonly ExportReply[]): string {
  const lines = [SAVED_REPLY_CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [r.title, r.shortcut, r.body, r.category, r.language, r.channelKinds.join('|')]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export interface ImportCandidate {
  line: number;
  shortcut: string;
  title: string;
  body: string;
  category: string | null;
  language: string | null;
  channelKinds: string[];
}

export type RowParse =
  | { ok: true; row: ImportCandidate }
  | { ok: false; line: number; shortcut: string; issue: SavedReplyImportIssue };

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const LANGUAGE = /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

/** Finds the columns by header name; `null` when shortcut, title or body is missing. */
export function columnIndexes(
  headers: readonly string[],
): Record<(typeof SAVED_REPLY_CSV_COLUMNS)[number], number> | null {
  const names = headers.map((h) => h.replace(/^﻿/, '').trim().toLowerCase());
  const at = (n: string) => names.indexOf(n);
  const idx = {
    title: at('title'),
    shortcut: at('shortcut'),
    body: at('body'),
    category: at('category'),
    language: at('language'),
    channel: at('channel') >= 0 ? at('channel') : at('channels'),
  };
  if (idx.title < 0 || idx.shortcut < 0 || idx.body < 0) return null;
  return idx;
}

/** One data row to a candidate, or the first thing wrong with it. Pure. */
export function parseRow(
  record: { line: number; cells: string[] },
  idx: NonNullable<ReturnType<typeof columnIndexes>>,
): RowParse {
  const get = (i: number): string => (i < 0 ? '' : unguardFormula(record.cells[i] ?? ''));
  const rawShortcut = get(idx.shortcut).trim();
  const shortcut = normalizeShortcut(rawShortcut);
  const bad = (issue: SavedReplyImportIssue): RowParse => ({
    ok: false,
    line: record.line,
    shortcut: shortcut || rawShortcut.slice(0, 64),
    issue,
  });
  if (rawShortcut === '') return bad('missing_shortcut');
  if (shortcut === '') return bad('shortcut_invalid');
  const title = get(idx.title).trim();
  if (title === '') return bad('missing_title');
  if (Array.from(title).length > SAVED_REPLY_TITLE_MAX) return bad('title_too_long');
  const body = get(idx.body).trim();
  if (body === '') return bad('missing_body');
  if (Array.from(body).length > SAVED_REPLY_BODY_MAX) return bad('body_too_long');
  if (CONTROL.test(body) || CONTROL.test(title)) return bad('control_characters');
  const category = get(idx.category).trim();
  if (Array.from(category).length > SAVED_REPLY_CATEGORY_MAX) return bad('category_too_long');
  const language = get(idx.language).trim();
  if (language !== '' && !LANGUAGE.test(language)) return bad('language_invalid');
  const channelKinds: string[] = [];
  for (const part of get(idx.channel).split(/[|,;]/)) {
    const kind = part.trim().toLowerCase();
    if (kind === '') continue;
    if (!channelKindSchema.safeParse(kind).success) return bad('channel_unknown');
    if (!channelKinds.includes(kind)) channelKinds.push(kind);
  }
  return {
    ok: true,
    row: {
      line: record.line,
      shortcut,
      title,
      body,
      category: category === '' ? null : category,
      language: language === '' ? null : language,
      channelKinds,
    },
  };
}
