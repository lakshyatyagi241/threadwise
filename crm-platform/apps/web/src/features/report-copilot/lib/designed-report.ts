/**
 * Reports the model designs itself (CopilotKit "Open Generative UI"): the runtime streams an `open-generative-ui` activity whose
 * content is HTML, CSS and a little JavaScript. CopilotKit runs it in a sandboxed iframe; this file holds what the page does with
 * that content around the iframe: the shape it reads, when it is complete, the file a person can download, and the brief the
 * model gets about how to design a report.
 */

/** The fields of the activity content the page reads (all optional: they arrive piece by piece while the model writes). */
export interface DesignedContent {
  initialHeight?: number | undefined;
  generating?: boolean | undefined;
  css?: string | undefined;
  cssComplete?: boolean | undefined;
  html?: string[] | undefined;
  htmlComplete?: boolean | undefined;
  jsFunctions?: string | undefined;
  jsExpressions?: string[] | undefined;
}

/** True once the model has finished writing the page, so it can be shown whole and downloaded. */
export const isDesignedReady = (c: DesignedContent): boolean =>
  c.generating === false && !!c.htmlComplete && !!c.html?.length;

/** A cheap fingerprint of the streamed content, to tell "the same content again" from "more content" without deep compares. */
export function designedSignature(c: DesignedContent): string {
  return [
    c.generating,
    c.initialHeight,
    c.cssComplete,
    c.css?.length ?? 0,
    c.htmlComplete,
    c.html?.length ?? 0,
    c.html?.reduce((n, p) => n + p.length, 0) ?? 0,
    c.jsFunctions?.length ?? 0,
    c.jsExpressions?.length ?? 0,
  ].join('|');
}

/** Code goes inside a <script> element: the closing tag must never appear in it. */
const scriptSafe = (code: string) => code.replace(/<\/(script)/gi, '<\\/$1');

/**
 * The finished page as one standalone .html file, built the way the sandbox builds it: the CSS in the head, the body as written,
 * then the model's functions and expressions as scripts at the end. Null while the model is still writing.
 */
export function buildDesignedHtml(c: DesignedContent, title: string): string | null {
  if (!isDesignedReady(c)) return null;
  let doc = c.html!.join('');
  if (!/<head[\s>]/i.test(doc)) doc = `<head></head>${doc}`;
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/[<>&]/g, '')}</title>${c.css ? `<style>${c.css}</style>` : ''}`;
  doc = doc.replace(/<head([^>]*)>/i, `<head$1>${head}`);
  const scripts = [c.jsFunctions, ...(c.jsExpressions ?? [])]
    .filter((s): s is string => !!s)
    .map((s) => `<script>${scriptSafe(s)}</script>`)
    .join('');
  if (scripts)
    doc = /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${scripts}</body>`) : doc + scripts;
  return /<!doctype/i.test(doc)
    ? doc
    : `<!DOCTYPE html>${/<html[\s>]/i.test(doc) ? doc : `<html>${doc}</html>`}`;
}

/**
 * What the model is told about designing a page itself. This is the explicit fallback: reports are normally shown with the show_*
 * blocks (typed components the page draws, in the app's colours, with live numbers). Only when the person asks for a custom or
 * bespoke design is a page written with generateSandboxedUi. It replaces CopilotKit's default design brief.
 */
export const REPORT_DESIGN_SKILL = `Do not use generateSandboxedUi for ordinary reports. Show reports with show_summary, show_kpis, show_chart and show_table: they draw in the application's own colours, update with the live numbers and can be exported. Write a page yourself with generateSandboxedUi ONLY when the person explicitly asks for a custom, bespoke or specially designed layout that those blocks cannot give. Then follow these rules:

- The page is shown large, in a panel beside the chat, inside a sandbox with no access to the application, its data or its API.
- Content: use only figures you read in the person's documents or in the figures you were given, and say where each came from. Never invent a number. If something is missing, say so on the page.
- Structure: a title, a short summary, key figures, sections with a heading and a short explanation, and a Sources list at the end.
- Charts: draw them yourself with inline SVG or CSS, using several distinct colours (one per series or slice), a legend and exact values on hover or in labels. Do not load libraries, fonts, scripts or images from the internet; the page must work with no network.
- Look: a clean light page with its own explicit colours (set a white background and dark text on the body; the panel behind it may be dark). System font stack, 14px body text, thin 1px borders, 8px radius. Use CSS grid or flexbox so it reads well from 320px to 900px wide.
- Behaviour: static content is best. Small interactions such as tabs or toggles are fine in plain JavaScript. No forms, no links to other sites, no attempts to read cookies, storage or the parent page.
- If the person wants a plain exportable report (Markdown, JSON or PDF), use the show_* blocks or render_report instead.`;
