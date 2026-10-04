const str = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);

/**
 * A variable-name field as the author typed it: one surrounding `{{ }}`, a leading `@`, braces and spaces are dropped, so an Ask
 * never stores under a literal key `{{name}}` (TW-FLR-013 rule 7).
 */
export function cleanVar(v: unknown, fallback: string): string {
  let s = str(v).trim();
  if (s === '') return fallback;
  s = s
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .replace(/^@/, '')
    .replace(/[{}\s]/g, '');
  return s === '' ? fallback : s;
}
