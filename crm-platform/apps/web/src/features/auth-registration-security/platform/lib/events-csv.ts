import type { SecurityEventRow } from './event-view';

/** One column per field the viewer can show, in the order an auditor reads them. */
export const CSV_COLUMNS = [
  'at',
  'status',
  'event',
  'actorType',
  'actorId',
  'actorName',
  'actorEmail',
  'orgId',
  'orgSlug',
  'orgName',
  'ip',
  'userAgent',
  'requestId',
  'payload',
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

/** Written first so Excel reads the file as UTF-8. Built from its code point to keep the source plain text. */
export const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A spreadsheet runs a cell that starts with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (a name, user agent or payload a
 * user controls) gets a leading apostrophe so it opens as text; cells with a comma, quote or line
 * break are quoted with the quotes doubled.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cellFor(row: SecurityEventRow, column: CsvColumn): unknown {
  if (column === 'payload') return Object.keys(row.payload).length === 0 ? '' : row.payload;
  return row[column];
}

/**
 * The rows as a CSV document: a header, then one line per event, CRLF between lines. It starts with a
 * byte-order mark so Excel reads names and payloads in other scripts as UTF-8.
 */
export function eventsToCsv(rows: readonly SecurityEventRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(cellFor(row, c))).join(','));
  return `${BYTE_ORDER_MARK}${lines.join('\r\n')}\r\n`;
}

/** `security-events-2026-10-01.csv`, by the viewer's local date. */
export function csvFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `security-events-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}
