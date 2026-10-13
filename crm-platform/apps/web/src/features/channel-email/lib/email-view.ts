import type { EmailAddress, EmailAttachment } from '@crm/contracts';

/** `Name <address>`, or the bare address when there is no name (or the name is the address). */
export function formatAddress(a: EmailAddress): string {
  const name = a.name?.trim();
  return name && name !== a.address ? `${name} <${a.address}>` : a.address;
}

export const formatAddresses = (list: readonly EmailAddress[]): string =>
  list.map(formatAddress).join(', ');

/** Attachments listed as files: the ones shown inside the body (inline) are not repeated. */
export const listedAttachments = (list: readonly EmailAttachment[]): EmailAttachment[] =>
  list.filter((a) => !a.inline);

/** The HTML pulls a picture or a style from the internet (the reason to offer "Load images"). */
export function hasRemoteImages(html: string): boolean {
  return (
    /<img\b[^>]*\b(?:src|srcset|background)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /\bbackground(?:-image)?\s*:[^;"'>]*url\(\s*["']?\s*(?:https?:)?\/\//i.test(html) ||
    /<[a-z]+\b[^>]*\bbackground\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html)
  );
}

/**
 * Takes out what a mail must never run or follow even though the server already cleaned it (a second wall: the frame is also
 * sandboxed without scripts and has its own content-security-policy). Tags that run, embed, redirect or re-base the page go.
 */
export function neutralise(html: string): string {
  return (
    html
      // Whole blocks that run or embed something.
      .replace(
        /<(script|iframe|frameset|object|applet|form|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
        '',
      )
      // Single tags that redirect, re-base or load: meta refresh, base, link, embed, frame, input forms.
      .replace(/<\/?(?:meta|base|link|embed|frame|script|iframe|object|form)\b[^>]*>/gi, '')
      // Event handlers.
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      // Script-carrying addresses.
      .replace(
        /(href|src|xlink:href|action|formaction)\s*=\s*(["']?)\s*(?:javascript:|vbscript:|data:text\/html)[^"'>\s]*\2/gi,
        '$1="#"',
      )
  );
}

/**
 * The document the frame shows. Remote pictures are blocked by the policy itself until the agent asks (`allowImages`): pictures that
 * ride inside the message (`data:`) always show. Links open in a new tab and carry no referrer.
 */
export function buildSrcDoc(html: string, allowImages: boolean, inlineBase?: string): string {
  // Pictures that ride inside the message (`cid:` parts) are our own files: the frame may load them from this origin even while remote
  // pictures stay blocked.
  const img = allowImages ? "img-src data: 'self' https: http:" : "img-src data: 'self'";
  const csp = `default-src 'none'; ${img}; style-src 'unsafe-inline'; font-src data:`;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<base target="_blank">' +
    '<style>html,body{margin:0;padding:0}body{font:14px/1.5 system-ui,sans-serif;color:#1f2937;word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:3px solid #d1d5db;color:#4b5563}a{color:#2563eb}</style>' +
    '</head><body>' +
    neutralise(inlineBase ? withInlineImages(html, inlineBase) : html) +
    '</body></html>'
  );
}

/** Points `cid:<attachment id>` pictures at the attachment download route (`base` ends with the message's address, no trailing slash). */
export function withInlineImages(html: string, base: string): string {
  return html.replace(
    /(\bsrc\s*=\s*["']?)cid:([A-Za-z0-9_-]{1,512})/gi,
    (_m, pre: string, id: string) => `${pre}${base}/${id}`,
  );
}
