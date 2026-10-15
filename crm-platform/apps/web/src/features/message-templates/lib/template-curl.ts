import type { TemplateSummary } from '@crm/contracts';

/** The key as the examples show it until the person puts their own (a key is shown only once, when it is created). */
export const CURL_KEY_PLACEHOLDER = 'YOUR_API_KEY';

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The distinct `{{tokens}}` of a text, in the order they first appear. */
export function tokensOf(text: string | null | undefined): string[] {
  const seen: string[] = [];
  for (const m of (text ?? '').matchAll(TOKEN)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

type Sendable = Pick<
  TemplateSummary,
  | 'status'
  | 'templateType'
  | 'body'
  | 'header'
  | 'attachmentType'
  | 'buttons'
  | 'pausedUntil'
  | 'qualityScore'
>;

/**
 * Whether the API can send this template (`POST /api/v1/templates/{id}/send`), as the endpoint decides it today: approved by Meta, not
 * paused, not rated red, not an authentication template, numbered body variables only, and nothing to fill in the header (no media, no
 * header variable) or in a link button. The API refuses the others, so no example is offered for them.
 */
export function curlAvailable(t: Sendable, now: Date = new Date()): boolean {
  if (t.status !== 'approved') return false;
  if (t.pausedUntil && new Date(t.pausedUntil).getTime() > now.getTime()) return false;
  if ((t.qualityScore ?? '').toUpperCase() === 'RED') return false;
  if (t.templateType === 'auth') return false;
  if (t.attachmentType !== 'none') return false;
  if (tokensOf(t.header).length > 0) return false;
  if (t.buttons.some((b) => tokensOf(b.url).length > 0)) return false;
  return tokensOf(t.body).every((k) => /^\d+$/.test(k));
}

const q = (s: string): string => s.replace(/'/g, `'\\''`);

/**
 * The cURL of the send request for one template, with a placeholder for the key, the number (not a real one: running it unedited fails
 * instead of messaging someone) and one value for each body variable.
 */
export function templateCurl(
  baseUrl: string,
  t: Pick<TemplateSummary, 'id' | 'body'>,
  key: string = CURL_KEY_PLACEHOLDER,
): string {
  const payload: Record<string, unknown> = { to: '<customer number with country code>' };
  const body = tokensOf(t.body);
  if (body.length > 0) payload.body = body.map((k) => `<value for {{${k}}}>`);
  return [
    `curl -X POST '${q(baseUrl)}/templates/${t.id}/send' \\`,
    `  -H 'Authorization: Bearer ${q(key)}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${q(JSON.stringify(payload, null, 2))}'`,
  ].join('\n');
}
