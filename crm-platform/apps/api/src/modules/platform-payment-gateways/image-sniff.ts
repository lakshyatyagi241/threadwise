import { isSafeSvg } from '../chatbot-widget/svg-safe';
/**
 * The file's real type from its first bytes (the client's claimed type and file name are never trusted). Used for the invoice
 * logo upload (TW-PAYGW-007): png, jpeg, webp and svg, the types Reference's form accepts.
 */
export const INVOICE_LOGO_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;

export function sniffImage(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  const head = buf.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(head))
    return isSafeSvg(buf) ? 'image/svg+xml' : null; // active SVG (script, links, entities) is refused (SEC-UPLOAD-1)
  return null;
}
