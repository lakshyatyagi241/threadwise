import { DNC_IMPORT_MAX_BYTES } from '@crm/contracts';

/**
 * A CSV cut into pieces the API takes in one request (BL-181): every piece keeps the first line (the header, or the first number of a file
 * with none: it is repeated, which only costs a duplicate that the list ignores) and stays under `DNC_IMPORT_MAX_BYTES` of UTF-8. Lines are
 * never split. An empty file gives no pieces.
 */
export function splitDncCsv(text: string, maxBytes: number = DNC_IMPORT_MAX_BYTES): string[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const head = lines[0]!;
  const size = (s: string) => new TextEncoder().encode(s).length + 1;
  // A budget that leaves room for the header on every piece and a safety margin for the JSON envelope.
  const budget = Math.max(1024, maxBytes - size(head) - 512);
  const pieces: string[] = [];
  let cur: string[] = [];
  let used = 0;
  for (const line of lines.slice(1)) {
    const n = size(line);
    if (cur.length > 0 && used + n > budget) {
      pieces.push([head, ...cur].join('\n'));
      cur = [];
      used = 0;
    }
    cur.push(line);
    used += n;
  }
  if (cur.length > 0 || pieces.length === 0) pieces.push([head, ...cur].join('\n'));
  return pieces;
}
