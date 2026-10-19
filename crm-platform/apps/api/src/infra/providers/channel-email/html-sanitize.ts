import sanitizeHtml from 'sanitize-html';
import { EMAIL_HTML_MAX } from '@crm/contracts';
import { cutAtTag } from '../../../common/html-limits';

export interface SanitizeOptions {
  /** Remote `<img>` sources are not loaded: the address moves to `data-remote-src` (the agent can ask to load them). */
  blockRemoteImages: boolean;
  /** The longest raw HTML read, in characters. */
  inputMaxChars: number;
  /** Maps a `cid:` reference to the id the attachment is served under. Unmapped inline images are dropped. */
  cidToAttachmentId?: ReadonlyMap<string, string>;
}

export interface SanitizedHtml {
  html: string;
  truncated: boolean;
}

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
];

const REMOTE_SRC = /^(https?:)?\/\//i;

/** Tags whose content is removed with the tag (a script's text is not mail text). */
const DISCARD_TAGS = [
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
];

function run(input: string, opts: SanitizeOptions): string {
  return sanitizeHtml(input, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'title', 'data-remote-src'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      '*': [],
    },
    // `cid:` is the inline image of the same mail; `data:` and everything else is dropped.
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    nonTextTags: DISCARD_TAGS,
    transformTags: {
      a: (tagName, attribs) => {
        const out: Record<string, string> = {};
        if (attribs.href) out.href = attribs.href;
        if (attribs.title) out.title = attribs.title;
        // A link out of a customer's mail must never hand its window to the page or leak the CRM address.
        out.target = '_blank';
        out.rel = 'noopener noreferrer nofollow';
        return { tagName, attribs: out };
      },
      img: (tagName, attribs) => {
        const out: Record<string, string> = { ...attribs };
        const src = (attribs.src ?? '').trim();
        delete out.src;
        if (/^cid:/i.test(src)) {
          const id = opts.cidToAttachmentId?.get(src.slice(4).replace(/^<|>$/g, '').trim());
          if (id) out.src = `cid:${id}`;
        } else if (REMOTE_SRC.test(src)) {
          if (opts.blockRemoteImages) out['data-remote-src'] = src;
          else out.src = src;
        }
        return { tagName, attribs: out };
      },
    },
    exclusiveFilter: (frame) => {
      // An image with nothing to show (a blocked tracking pixel is kept as a placeholder so the agent can load it; an unmapped cid is not).
      if (frame.tag === 'img') return !frame.attribs.src && !frame.attribs['data-remote-src'];
      return false;
    },
  });
}

/**
 * The HTML body of a mail made safe to show to an agent: scripts, styles, forms, frames and every event attribute are gone, links open in a
 * new window with no referrer, remote images are not loaded (TW-MAIL-026) and the result fits {@link EMAIL_HTML_MAX}. An over-long body is
 * cut and re-sanitised so the cut never leaves an open tag.
 */
export function sanitizeEmailHtml(raw: string, opts: SanitizeOptions): SanitizedHtml {
  let input = raw;
  let truncated = false;
  if (input.length > opts.inputMaxChars) {
    input = input.slice(0, opts.inputMaxChars);
    truncated = true;
  }
  const cut = cutAtTag(input);
  if (cut !== input) {
    input = cut;
    truncated = true;
  }
  let html = run(input, opts);
  if (html.length <= EMAIL_HTML_MAX) return { html, truncated };
  truncated = true;
  // Cut the INPUT proportionally (the sanitised text is a fraction of it) and sanitise again until it fits.
  let limit = Math.floor(input.length * (EMAIL_HTML_MAX / html.length) * 0.95);
  for (let i = 0; i < 6 && html.length > EMAIL_HTML_MAX; i += 1) {
    let cut = input.slice(0, Math.max(0, limit));
    // Never end inside a tag.
    const open = cut.lastIndexOf('<');
    if (open > cut.lastIndexOf('>')) cut = cut.slice(0, open);
    html = run(cut, opts);
    limit = Math.floor(limit * 0.8);
  }
  if (html.length > EMAIL_HTML_MAX) html = html.slice(0, EMAIL_HTML_MAX - 0).replace(/<[^>]*$/, '');
  return { html, truncated };
}

/** A plain-text rendering of an HTML body, for a mail that has no text part (search, previews, the message body). */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<\s*(li)\b[^>]*>/gi, '- ');
  const text = sanitizeHtml(withBreaks, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: DISCARD_TAGS,
  });
  return decodeEntities(text)
    .split('\n')
    .map(stripTrailingBlanks)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A line without the spaces and tabs at its end. Not `/[ \t]+\n/`: that is quadratic on a long run of tabs that is not followed by a line break. */
function stripTrailingBlanks(line: string): string {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end -= 1;
  return end === line.length ? line : line.slice(0, end);
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** The entities the sanitiser's text mode writes, turned back into characters (a text part is not HTML). */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1]!.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
