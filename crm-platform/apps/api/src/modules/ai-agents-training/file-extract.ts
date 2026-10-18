import { inflateRawAsync } from '../../common/async-zlib';
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

/** Paragraph ends and line breaks become newlines, tabs stay tabs, every other tag goes; runs of blank lines collapse. */
export async function docxToText(file: Buffer): Promise<string> {
  const xml = (await readZipEntry(file, 'word/document.xml'))?.toString('utf8');
  if (!xml) return '';
  const text = decodeEntities(
    xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\b[^>]*\/?>/g, '\t')
      .replace(/<w:br\b[^>]*\/?>/g, '\n')
      .replace(/<[^>]*>/g, ''),
  );
  return text.replace(/\n{3,}/g, '\n\n').trim();
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
