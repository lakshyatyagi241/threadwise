import { inflateRawAsync, yieldToLoop } from '../../common/async-zlib';
import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '@crm/contracts';
import { HttpStatus } from '@nestjs/common';
import { decodeEntities, isBinaryText, stripHtml } from './training-rules';

/** Decompressed size a single document part may reach: a small file that inflates to gigabytes is a zip bomb, not a document. */
const MAX_INFLATED = 64 * 1024 * 1024;
const PDF_TIMEOUT_MS = 30_000;

const unreadable = () =>
  new AppError(
    ERROR_CODES.AIAG_FILE_UNREADABLE,
    'Could not read that file: it may be corrupt or password-protected. Try another file or paste the text.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

/**
 * Reads one named part out of a ZIP (a .docx is one). A small reader over the central directory, using only `zlib`: no archive
 * library, and nothing is ever written to disk. Entries that are encrypted, use a method other than stored or deflate, or inflate
 * past the cap are refused.
 */
export async function readZipEntry(zip: Buffer, name: string): Promise<Buffer | null> {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const LOC = 0x04034b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable();
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== CEN) throw unreadable();
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const entryName = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if ((flags & 1) !== 0) throw unreadable();
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOC) throw unreadable();
    const start =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(start, start + compressedSize);
    if (data.length !== compressedSize) throw unreadable();
    if (method === 0) return data;
    if (method === 8) {
      try {
        return await inflateRawAsync(data, { maxOutputLength: MAX_INFLATED });
      } catch {
        throw unreadable();
      }
    }
    throw unreadable();
  }
  return null;
}

/** How much XML one pass of the clean-up handles before the event loop gets a turn. A 2 MB part held it about 170 ms in one go. */
const DOCX_SLICE_CHARS = 256 * 1024;

/** The clean-up of one slice of document.xml: paragraph ends and line breaks become newlines, tabs stay tabs, every other tag goes. */
const docxSlice = (xml: string): string =>
  decodeEntities(
    xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  );

/**
 * Paragraph ends and line breaks become newlines, tabs stay tabs, every other tag goes; runs of blank lines collapse. The XML is cut
 * only right after a `</w:p>`, where no tag and no entity can be open, so each slice cleans up exactly as the whole would; a run of
 * newlines that straddles a cut is collapsed across it. The result is identical to cleaning the whole part at once. `sliceChars` is
 * a parameter for the tests.
 */
export async function docxToText(file: Buffer, sliceChars = DOCX_SLICE_CHARS): Promise<string> {
  const xml = (await readZipEntry(file, 'word/document.xml'))?.toString('utf8');
  if (!xml) return '';
  const parts: string[] = [];
  // How many newlines end what is collected so far (at most 2): kept as a number, never found by scanning the growing output.
  let t = 0;
  let from = 0;
  while (from < xml.length) {
    const close = xml.indexOf('</w:p>', from + sliceChars);
    const to = close === -1 ? xml.length : close + '</w:p>'.length;
    let part = docxSlice(xml.slice(from, to)).replace(/\n{3,}/g, '\n\n');
    // Blank-line runs of 3 or more become exactly 2, also across a cut: with t newlines already at the end of the output and l at the
    // start of `part` (both at most 2 here), t + l >= 3 means the run must total 2.
    let l = 0;
    while (l < part.length && part.charCodeAt(l) === 10) l += 1;
    if (t + l >= 3) part = '\n'.repeat(2 - t) + part.slice(l);
    parts.push(part);
    let trailing = 0;
    while (trailing < part.length && part.charCodeAt(part.length - 1 - trailing) === 10)
      trailing += 1;
    t = trailing === part.length ? Math.min(2, t + trailing) : trailing;
    from = to;
    if (from < xml.length) await yieldToLoop();
  }
  return parts.join('').trim();
}

async function pdfToText(file: Buffer): Promise<string> {
  // Loaded on first use: most workspaces never upload a PDF, and the parser is the largest dependency of this module.
  const { extractText, getDocumentProxy } = await import('unpdf');
  const work = (async () => {
    const pdf = await getDocumentProxy(new Uint8Array(file));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  })();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('pdf timed out')), PDF_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reduces an uploaded knowledge file to plain text by extension: PDF through the parser, DOCX through the ZIP reader, HTML with
 * its scripts and styles dropped, everything else read as UTF-8. A failure is an `AIAG_FILE_UNREADABLE` problem, never a stack.
 */
export async function extractFileText(file: Buffer, ext: string): Promise<string> {
  try {
    switch (ext) {
      case 'pdf':
        return await pdfToText(file);
      case 'docx':
        return await docxToText(file);
      case 'html':
      case 'htm':
        return stripHtml(file.toString('utf8')).trim();
      default: {
        const text = file.toString('utf8');
        if (isBinaryText(text)) throw unreadable();
        return text;
      }
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw unreadable();
  }
}
