/**
 * CSV output for contact exports and the import's rejected-rows report.
 *
 * Quoting follows RFC 4180 (a cell with a comma, quote or line break is wrapped in quotes,
 * quotes doubled). Lines end with \n like Reference's files.
 */
export const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * Spreadsheet formula injection guard: a text cell beginning with = + - or @ is read by Excel
 * as a formula, so it gets a leading apostrophe. It is applied to free-text columns only.
 * Reference applied it to every cell, which turned every "+91..." number and "+91" country code
 * (the format its own UI wrote) into "'+91...".
 */
export function guardFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(
  cells: ReadonlyArray<string | number | boolean | null | undefined>,
): string {
  return `${cells.map(csvCell).join(',')}\n`;
}
