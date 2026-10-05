import { inflateRawSync } from 'node:zlib';

/**
 * Reads the first worksheet of an .xlsx file as rows of text. Meta publishes its rate cards as Excel workbooks (even where the
 * download is labelled CSV), so the importer has to open one. This is not a spreadsheet library: it understands the zip container,
 * shared strings, inline strings and plain values, which is everything such a file uses. Pure: bytes in, rows out.
 *
 * Guarded against a hostile file: the declared sizes are capped, a part is inflated with an output limit, and anything that does
 * not look like a workbook is refused with a plain reason.
 */

export class XlsxError extends Error {}

const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 200;

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function centralDirectory(buf: Buffer): Entry[] {
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  const from = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('This is not an Excel workbook (.xlsx).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxError('The workbook has too many parts.');
  const entries: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new XlsxError('The workbook is damaged.');
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.push({
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      localOffset: buf.readUInt32LE(p + 42),
      name: buf.toString('utf8', p + 46, p + 46 + nameLen),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function partText(buf: Buffer, e: Entry): string {
  const p = e.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new XlsxError('The workbook is damaged.');
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method !== 8) throw new XlsxError('The workbook uses an unsupported compression.');
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES }).toString('utf8');
  } catch {
    throw new XlsxError('The workbook could not be read.');
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return XML_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** The text of every <t> in a fragment, joined (a rich-text string is several runs). */
function textRuns(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
    out += unescapeXml(m[1] ?? '');
  return out;
}

/** "AB12" -> zero-based column index 27. */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** The first worksheet as rows of trimmed text; empty cells are empty strings, empty rows are dropped. */
export function readXlsx(buf: Buffer): string[][] {
  const entries = centralDirectory(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const sheetEntry =
    byName.get('xl/worksheets/sheet1.xml') ??
    entries
      .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!sheetEntry) throw new XlsxError('The workbook has no worksheet.');

  const shared: string[] = [];
  const sst = byName.get('xl/sharedStrings.xml');
  if (sst) {
    for (const m of partText(buf, sst).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g))
      shared.push(textRuns(m[1] ?? ''));
  }

  const rows: string[][] = [];
  const sheet = partText(buf, sheetEntry);
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const body = c[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 'inlineStr') text = textRuns(body);
      else if (value !== undefined)
        text = type === 's' ? (shared[Number(value)] ?? '') : unescapeXml(value);
      const col = ref ? columnIndex(ref) : cells.length;
      while (cells.length < col) cells.push('');
      cells[col] = text.trim();
    }
    if (cells.some((c) => c !== '')) rows.push(cells);
  }
  return rows;
}

/** True when the bytes start like a zip container (an .xlsx), so the caller can tell a workbook from a text file. */
export function looksLikeXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}
