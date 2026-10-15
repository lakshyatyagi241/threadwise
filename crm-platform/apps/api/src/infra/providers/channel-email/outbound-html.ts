import sanitizeHtml from 'sanitize-html';
import { htmlToText } from './html-sanitize';
import { textToHtml } from './mime-build';

/**
 * What an agent writes goes out as mail (TW-MAIL-027): the composer's HTML and a signature's HTML are made safe with an email allow-list
 * (formatting, lists, quotes and links; no scripts, styles, forms, frames, event attributes or `javascript:` links; no images, so nothing can
 * load a tracking pixel from, or leak a file to, a third party). The text part is derived from the cleaned HTML.
 */
const OUTBOUND_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
  'ul',
];

const DISCARD = [
  'script',
  'style',
  'head',
  'title',
  'noscript',
  'template',
  'object',
  'embed',
  'iframe',
  'svg',
  'math',
  'textarea',
  'select',
  'button',
];

export function sanitizeOutboundHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: OUTBOUND_TAGS,
    allowedAttributes: { a: ['href', 'title'], '*': [] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: DISCARD,
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...(attribs.href ? { href: attribs.href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          rel: 'noopener noreferrer',
        },
      }),
    },
  }).trim();
}

/** The plain-text twin of cleaned HTML. */
export const outboundText = (cleanHtml: string): string => htmlToText(cleanHtml);

/** Whether `mime` passes the allow list (empty = anything) and the deny list (always wins). Entries are `type/subtype` or `type/*`. */
export function mimeAllowed(
  mime: string,
  allow: readonly string[],
  deny: readonly string[],
): boolean {
  const m = mime.split(';')[0]!.trim().toLowerCase();
  const hit = (rule: string) => {
    const r = rule.trim().toLowerCase();
    if (!r) return false;
    return r.endsWith('/*') ? m.startsWith(r.slice(0, -1)) : m === r;
  };
  if (deny.some(hit)) return false;
  const rules = allow.filter((r) => r.trim() !== '');
  return rules.length === 0 || rules.some(hit);
}

/** `a/*, b/c` -> `['a/*', 'b/c']`. */
export const mimeList = (csv: string): string[] =>
  csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export interface SignatureVariables {
  name: string;
  title: string;
  phone: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills `{{name}}`, `{{title}}` and `{{phone}}` (case-insensitive, spaces allowed inside); other braces are left as written. */
export function fillSignatureVariables(
  template: string,
  vars: SignatureVariables,
  mode: 'html' | 'text',
): string {
  return template.replace(/\{\{\s*(name|title|phone)\s*\}\}/gi, (_m, key: string) => {
    const v = vars[key.toLowerCase() as keyof SignatureVariables] ?? '';
    return mode === 'html' ? escapeHtml(v) : v;
  });
}

/** The standard signature separator (RFC 3676): dash dash space on its own line. */
export const SIGNATURE_SEPARATOR = '-- ';

export interface MergedBody {
  text: string;
  /** Null when neither the reply nor the signature has HTML (a plain-text reply). */
  html: string | null;
}

/**
 * Appends a signature (already sanitised, variables filled) to a reply: text after a `-- ` line, HTML in its own block after a
 * separator line. A reply with no HTML body but an HTML signature gets the escaped text as its HTML part, so both parts carry it.
 */
export function mergeSignature(
  body: { text: string; html: string | null },
  signature: { text: string; html: string } | null,
): MergedBody {
  if (!signature || (signature.text.trim() === '' && signature.html.trim() === '')) return body;
  const sigText =
    signature.text.trim() !== '' ? signature.text.trim() : outboundText(signature.html);
  const sigHtml = signature.html.trim() !== '' ? signature.html : textToHtml(sigText);
  const text = `${body.text.replace(/\s+$/, '')}\n\n${SIGNATURE_SEPARATOR}\n${sigText}`;
  const baseHtml = body.html ?? textToHtml(body.text);
  const html = `${baseHtml}<div><br></div><div>${SIGNATURE_SEPARATOR.trim()}</div><div>${sigHtml}</div>`;
  return { text, html };
}
