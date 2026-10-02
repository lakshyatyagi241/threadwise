/**
 * Pre-flight checks on the template a broadcast will send (TW-BCAST-012). They refuse the broadcast before any
 * quota is spent or any row is written. All pure so they can be tested without a database.
 */

export interface TemplateFacts {
  templateType: string;
  attachmentType: string | null;
  /** Public URL of the header media, when the storage layer can resolve one. */
  mediaUrl: string | null;
  metaTemplateId: string | null;
  metaStatus: string | null;
  pausedUntil: Date | null;
  qualityScore: string | null;
}

/** OTP templates need a unique verifiable code per recipient, which a broadcast cannot give. */
export const AUTH_TEMPLATE_MESSAGE =
  'Authentication (OTP) templates cannot be broadcast — each recipient needs a unique verifiable code. ' +
  'Send them 1:1 from your backend using the transactional template send endpoint instead.';

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^(22[4-9]|2[3-5]\d)\./,
];

const isIpLiteral = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
const isPrivateIp = (host: string) =>
  host.includes(':')
    ? host === '::1' || /^(fc|fd|fe80)/i.test(host)
    : PRIVATE_V4.some((r) => r.test(host));

/** Meta (and every recipient's client) must be able to fetch the media: https, public host. Null means fine. */
export function mediaUrlProblem(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Media URL '${url}' is invalid.`;
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  if (scheme !== 'https') {
    return `Media URL must be HTTPS for Meta to fetch it (got: ${scheme}). Configure a public https:// media domain.`;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIpLiteral(host)) {
    return isPrivateIp(host)
      ? `Media URL host '${host}' is a private/reserved IP. Meta cannot reach it. Use a public domain.`
      : null;
  }
  for (const bad of ['.local', '.test', '.internal', '.localhost']) {
    if (host.endsWith(bad)) {
      return `Media URL host '${host}' ends with ${bad} which Meta cannot resolve. Use a public domain.`;
    }
  }
  if (host === 'localhost')
    return "Media URL host is 'localhost'. Meta cannot reach it. Use a public domain.";
  return null;
}

/** Every reason this template cannot go out in a broadcast right now; empty means it can. */
export function templateRefusals(
  tpl: TemplateFacts,
  opts: { wabaTemplatesV2: boolean; now?: Date },
): string[] {
  if (tpl.templateType === 'auth') return [AUTH_TEMPLATE_MESSAGE];

  const out: string[] = [];
  const att = (tpl.attachmentType ?? '').toUpperCase();
  const needsMedia = att !== '' && !['NONE', 'TEXT', 'LOCATION'].includes(att);
  if (needsMedia && tpl.mediaUrl) {
    const problem = mediaUrlProblem(tpl.mediaUrl);
    if (problem) out.push(`Cannot broadcast this template: ${problem}`);
  }

  // The Meta guardrails only apply to a template that was submitted to Meta, with the v2 switch on.
  if (tpl.metaTemplateId && opts.wabaTemplatesV2) {
    const reasons: string[] = [];
    if ((tpl.metaStatus ?? '').toUpperCase() !== 'APPROVED') {
      reasons.push(
        `Template is not approved by Meta yet (status: ${tpl.metaStatus}). Wait for approval.`,
      );
    }
    const now = opts.now ?? new Date();
    if (tpl.pausedUntil && tpl.pausedUntil.getTime() > now.getTime()) {
      reasons.push(
        `Template is paused until ${tpl.pausedUntil.toISOString().slice(0, 16).replace('T', ' ')} due to negative customer feedback. ` +
          'Sending now would worsen the quality score.',
      );
    }
    // Only RED refuses: UNKNOWN means Meta has not rated a new or rarely sent template, which is not poor quality.
    if ((tpl.qualityScore ?? 'UNKNOWN').toUpperCase() === 'RED') {
      reasons.push(
        'Template quality score is RED — sending now would accelerate the quality drop and risk a Meta ban.',
      );
    }
    if (reasons.length) out.push(`Cannot broadcast this template: ${reasons.join(' ')}`);
  }
  return out;
}
