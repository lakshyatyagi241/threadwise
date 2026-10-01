import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';

/**
 * Rich-text sanitiser (WD-AUTH-044). WaDesk's was a deny-list of tags that let
 * unknown elements through despite its "allow-list" docblock; this is a real
 * allow-list, applied at write time and again at render time by consumers
 * (storefront product bodies, guidebook articles, announcements).
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
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
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
