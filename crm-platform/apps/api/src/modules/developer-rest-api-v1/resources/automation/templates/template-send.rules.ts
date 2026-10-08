/** The pure rules of `POST /templates/{id}/send` (TW-API-036): variables, who may be sent to, why a template is not sendable. */

/** `body` is a list, or a 1-indexed map that is sorted by number and re-indexed to a list. Empty values are dropped from the end only. */
export function bodyValuesOf(body: string[] | Record<string, string> | undefined): string[] {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  return Object.entries(body)
    .sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
    .map(([, v]) => v);
}

/** The digits of the recipient: `+` and every separator are stripped before the send, as Reference did. */
export const recipientDigits = (to: string): string => to.replace(/\D/g, '');

export interface SendFacts {
  status: string;
  metaStatus: string | null;
  pausedUntil: Date | null;
  qualityScore: string | null;
  templateType: string;
  parameterFormat: string;
  attachmentType: string | null;
}

/** Reference's sender gates, in its order, as the code each is answered with (`details.template_id` rides along). */
export type SendBlock = 'not_approved' | 'paused' | 'quality_floor' | 'unsupported_template';

export function sendBlockOf(t: SendFacts, now: Date): { code: SendBlock; message: string } | null {
  const approved =
    (t.status === 'approved' || t.status === 'public') &&
    (t.metaStatus === null || t.metaStatus === 'APPROVED');
  if (!approved)
    return { code: 'not_approved', message: 'This template is not approved by Meta yet.' };
  if (t.pausedUntil && t.pausedUntil.getTime() > now.getTime())
    return { code: 'paused', message: 'This template is paused by Meta.' };
  if ((t.qualityScore ?? '').toUpperCase() === 'RED')
    return {
      code: 'quality_floor',
      message: 'This template has a RED quality rating and cannot be sent.',
    };
  if (t.templateType === 'auth' || t.parameterFormat === 'NAMED')
    return {
      code: 'unsupported_template',
      message: 'Authentication and named-variable templates cannot be sent through the API yet.',
    };
  return null;
}

/** The body as the customer reads it: each placeholder replaced by the value at its position. */
export function renderBody(body: string, tokens: string[], values: string[]): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, t: string) => {
    const i = tokens.indexOf(t);
    return i >= 0 && values[i] !== undefined ? values[i]! : m;
  });
}
