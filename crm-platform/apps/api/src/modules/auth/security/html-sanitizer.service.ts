import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * Rich-text sanitiser (WD-AUTH-044). WaDesk's was a deny-list of tags that let
 * unknown elements through despite its "allow-list" docblock; this is a real
 * allow-list, applied at write time and again at render time by consumers
 * (storefront product bodies, announcements).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'div',
    'span',
    'blockquote',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'caption',
    'colgroup',
    'col',
    'tr',
    'th',
    'td',
    // Text-level and block elements that storefront bodies carry.
    'figure',
    'figcaption',
    'small',
    'del',
    'ins',
    'mark',
    'abbr',
    'cite',
    'q',
    'address',
    'dl',
    'dt',
    'dd',
    'section',
    'article',
  ],
  // The text inside these goes with the element. A discarded `<iframe>` or
  // `<form>` is not a formatting wrapper: its fallback text, labels and nested
  // markup were put there for a browser that renders the element, and would
  // show up as stray words if kept. (script/style/textarea/option are the library's own.)
  nonTextTags: [
    'script',
    'style',
    'textarea',
    'option',
    'iframe',
    'object',
    'embed',
    'form',
    'noscript',
    'template',
    'svg',
    'math',
    'audio',
    'video',
    'applet',
    'frameset',
    'frame',
    'head',
    'title',
  ],
  allowedAttributes: {
    '*': ['dir', 'lang'],
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  // No data:, javascript:, vbscript: or about: anywhere.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // An image whose source was stripped (data:, javascript:) is dropped, not left as an empty tag.
  exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
  transformTags: {
    // Links that open a new tab must not be able to reach back to this page.
    a: (tagName, attribs) => ({
      tagName,
      attribs: attribs.target ? { ...attribs, rel: 'noopener noreferrer nofollow' } : attribs,
    }),
  },
};

@Injectable()
export class HtmlSanitizerService {
  sanitize(html: string | null | undefined): string {
    if (!html) return '';
    try {
      return sanitizeHtml(html, OPTIONS);
    } catch {
      // Fail closed: escape rather than risk passing markup through.
      return html.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
      );
    }
  }
}
