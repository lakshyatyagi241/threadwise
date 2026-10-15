import type { TemplateSummary } from '@crm/contracts';
import { tokensOf } from './variables';

export const CURL_PLACEHOLDER_KEY = 'YOUR_API_KEY';
/** The path every customer-API URL starts with (Reference's base URL, kept as is). */
export const API_V1_PATH = '/api/v1';

export function apiBaseUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${API_V1_PATH}`;
}

/** Only an approved template can be sent; the API refuses every other status. */
export const canSendViaApi = (t: Pick<TemplateSummary, 'status' | 'metaCategory'>): boolean =>
  (t.status === 'approved' || t.status === 'public') && t.metaCategory !== 'AUTHENTICATION';

/**
 * The copy-ready `POST /templates/{id}/send` request for one template: a value slot for each body variable, the header (text variable
 * or media URL) and each dynamic URL button the template has, so the person only swaps the sample values.
 */
export function templateSendCurl(
  baseUrl: string,
  tpl: Pick<TemplateSummary, 'id' | 'body' | 'header' | 'attachmentType' | 'buttons'>,
  key: string = CURL_PLACEHOLDER_KEY,
  to = '919812345678',
): string {
  const body: Record<string, unknown> = { to };
  const vars = tokensOf(tpl.body);
  if (vars.length > 0) body.body = vars.map((_, i) => `value_${i + 1}`);
  if (tpl.attachmentType === 'image' || tpl.attachmentType === 'video') {
    body.header_media_url = `https://example.com/file.${tpl.attachmentType === 'image' ? 'jpg' : 'mp4'}`;
  } else if (tpl.attachmentType === 'document') {
    body.header_media_url = 'https://example.com/file.pdf';
    body.header_filename = 'file.pdf';
  } else if (tpl.header && tokensOf(tpl.header).length > 0) {
    body.header_text = 'header_value';
  }
  const dynamic = tpl.buttons
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.type.toLowerCase() === 'url' && /\{\{/.test(b.url ?? ''))
    .map(({ index }) => ({ index, sub_type: 'url', value: 'url_suffix' }));
  if (dynamic.length > 0) body.buttons = dynamic;
  const json = JSON.stringify(body, null, 2).replace(/'/g, `'\\''`);
  return [
    `curl -X POST '${baseUrl}/templates/${tpl.id}/send' \\`,
    `  -H 'Authorization: Bearer ${key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${json}'`,
  ].join('\n');
}
