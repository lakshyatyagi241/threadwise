/**
 * The small, safe rich text of the email composer and of signatures (TW-MAIL-027). The editor produces HTML, and every piece of HTML
 * that is shown or sent from here goes through {@link sanitizeHtml} first: it is an allow-list that REBUILDS the markup token by token,
 * so nothing the source contained survives unless it is a listed tag with a listed attribute. It needs no DOM, so it behaves the same
 * in the browser, in the server render and in tests. The server sanitises again; this is the first wall, not the only one.
 */

/** Tags the composer can produce and a reply may carry. */
const ALLOWED = new Set([
  'p',
  'div',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'ul',
  'ol',
  'li',
  'blockquote',
  'a',
  'pre',
  'code',
  'hr',
]);
const VOID = new Set(['br', 'hr']);
/** Tags whose content is dropped with them (never shown as text). */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'textarea',
  'noscript',
  'template',
  'svg',
  'math',
  'head',
  'title',
  'select',
  'option',
  'button',
  'form',
  'frameset',
  'applet',
]);
const LINK_SCHEMES = /^(?:https?:|mailto:|tel:)/i;

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  colon: ':',
  tab: '\t',
  newline: '\n',
  lpar: '(',
  rpar: ')',
};

/** Decodes the entities a browser would decode inside an attribute or text, to judge what a value really says. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const escText = (s: string): string => s.replace(/>/g, '&gt;');
const escAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The address of a link when it is one we keep (web, mail, phone), else null. */
export function safeHref(raw: string): string | null {
  const value = decodeEntities(raw).trim();
  // Browsers ignore tabs, new lines and control characters inside a scheme: judge the value without them.
  // eslint-disable-next-line no-control-regex
  const probe = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  return LINK_SCHEMES.test(probe) ? value : null;
}

function hrefOf(attrs: string): string | null {
  const m = /(?:^|[\s"'/])href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  const raw = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  return raw ? safeHref(raw) : null;
}

const TOKEN =
  /<!--[\s\S]*?-->|<!--[\s\S]*$|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<[a-zA-Z/!?][^>]*$|<[!?][^>]*>|[^<]+|</g;

/** The allow-listed HTML of `html`: a rebuilt copy, never a filtered one. Anything not listed is removed, its text kept. */
export function sanitizeHtml(html: string): string {
  let out = '';
  const stack: string[] = [];
  let skip: string | null = null;
  for (const m of html.matchAll(TOKEN)) {
    const token = m[0];
    const name = m[1]?.toLowerCase();
    if (name === undefined) {
      // Text, a comment, a doctype or a broken tag. Only text survives.
      if (skip === null && !token.startsWith('<')) out += escText(token);
      else if (skip === null && token === '<') out += '&lt;';
      continue;
    }
    const closing = token.startsWith('</');
    if (skip !== null) {
      if (closing && name === skip) skip = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !token.endsWith('/>')) skip = name;
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out += `</${stack.pop()}>`;
      continue;
    }
    if (VOID.has(name)) {
      out += `<${name}>`;
      continue;
    }
    if (name === 'a') {
      const href = hrefOf(m[2] ?? '');
      out += href
        ? `<a href="${escAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">`
        : '<a>';
    } else {
      out += `<${name}>`;
    }
    stack.push(name);
  }
  while (stack.length > 0) out += `</${stack.pop()}>`;
  return out;
}

/** Plain text to the paragraphs the editor starts from. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return paragraphs
    .filter((p) => p.trim() !== '')
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** The plain-text reading of HTML: what goes in the text part of the mail, and what search and previews show. */
export function htmlToText(html: string): string {
  const clean = sanitizeHtml(html);
  const text = clean
    .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const plain = label.replace(/<[^>]*>/g, '');
      const url = decodeEntities(href);
      return plain.trim() === '' || plain.trim() === url || url.startsWith('mailto:')
        ? plain || url
        : `${plain} (${url})`;
    })
    .replace(/<li>/gi, '- ')
    .replace(
      /<blockquote>([\s\S]*?)<\/blockquote>/gi,
      (_m, inner: string) =>
        inner
          .replace(/<br>|<\/(?:p|div|li)>/gi, '\n')
          .replace(/<[^>]*>/g, '')
          .split('\n')
          .map((l) => (l.trim() ? `> ${l.trim()}` : ''))
          .join('\n') + '\n',
    )
    .replace(/<br>|<hr>/gi, '\n')
    .replace(/<\/(?:p|div|li|ul|ol|pre)>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The HTML has no visible text (an empty editor leaves `<div><br></div>` behind). */
export const isBlankHtml = (html: string): boolean => htmlToText(html) === '';

/** What a person is named in `{{name}}`, `{{title}}` and `{{phone}}` of a signature. */
export interface SignatureVariables {
  name: string;
  title: string;
  phone: string;
}

const escHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills `{{name}}`, `{{title}}` and `{{phone}}` of signature HTML with the sender's values (escaped); unknown variables are left out. */
export function fillSignatureVariables(html: string, vars: SignatureVariables): string {
  return html.replace(/\{\{\s*([a-z]+)\s*\}\}/gi, (_m, key: string) => {
    const k = key.toLowerCase();
    return k === 'name' || k === 'title' || k === 'phone' ? escHtml(vars[k]) : '';
  });
}
