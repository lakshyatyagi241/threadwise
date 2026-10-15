/**
 * CSV export of submissions (docs/specs/forms-builder-app.md 7.1 and 14). A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage
 * return is read by a spreadsheet as a FORMULA, and the contents are a stranger's words: a visitor who types `=HYPERLINK(...)` into a
 * field must not be able to run it on the staff member who opens the export. Such a cell is prefixed with an apostrophe, which every
 * spreadsheet shows as plain text.
 */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : Array.isArray(value)
        ? value.join('; ')
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(',');
}

/** A whole CSV document, header first, CRLF line ends (what spreadsheets expect), and a BOM-less UTF-8 body. */
export function buildCsv(
  header: readonly string[],
  rows: ReadonlyArray<readonly unknown[]>,
): string {
  return [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}
