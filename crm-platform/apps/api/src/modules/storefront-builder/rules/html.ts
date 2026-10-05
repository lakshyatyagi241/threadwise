import sanitizeHtml from 'sanitize-html';

const SCHEMES = ['http', 'https', 'mailto', 'tel'];

/**
 * Hero and footer text (decision D-05). WaDesk printed the hero text as raw HTML on the public page (a merchant could plant
 * a script, and the Meridian theme leans on `<em>`); the text is still allowed a little markup, but only this allow-list:
 * b, i, em, strong, br, a[href] and span. Everything else is dropped and its text kept; attributes other than `href` go.
 */
const COPY_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['b', 'i', 'em', 'strong', 'br', 'a', 'span'],
  allowedAttributes: { a: ['href', 'rel'] },
  allowedSchemes: SCHEMES,
  allowProtocolRelative: false,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  disallowedTagsMode: 'discard',
};

export const sanitizeShopCopy = (text: string | null | undefined): string =>
  sanitizeHtml(text ?? '', COPY_OPTIONS);

/**
 * The product's rich-text body: the shop shows it unescaped, so it is cleaned at render time whatever the catalogue stored
 * (scripts, event handlers, style attributes, iframes and javascript: links never survive).
 */
const BODY_OPTIONS: sanitizeHtml.IOptions = {
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
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: SCHEMES,
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }) },
  disallowedTagsMode: 'discard',
};

export const sanitizeProductBody = (html: string | null | undefined): string | null => {
  if (!html || html.trim() === '') return null;
  return sanitizeHtml(html, BODY_OPTIONS);
};
