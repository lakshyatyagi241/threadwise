/**
 * Delivery reports from Twilio and MSG91 (TW-SMS-022). Pure: reads a payload and says which message it is about and what
 * happened to it, in our terms.
 */

export type ReportStatus = 'sent' | 'delivered' | 'failed';

/**
 * A provider status text to a status, evaluated on the lower-cased trimmed text. Failure is checked before delivery so
 * "undelivered" can never read as delivered. Anything that says nothing new (queued, sending, accepted, unknown numeric codes)
 * is null and records nothing.
 *
 * Two deliberate differences from Reference: Twilio's `delivery_unknown` and `partially_delivered` are not delivery (Reference
 * read anything containing "deliv" as delivered), and MSG91's do-not-disturb rejection matches `ndnc` as well as Reference's `ndnd`
 * (a typo for the Indian registry's name).
 */
export function mapProviderStatus(raw: string): ReportStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s === 'sent') return 'sent';
  if (s === 'delivered') return 'delivered';
  if (s === 'undelivered' || s === 'failed') return 'failed';
  if (s === 'delivery_unknown' || s === 'partially_delivered') return null;
  if (
    ['2', '5', '6', '9', '13', '17', '25'].includes(s) ||
    ['fail', 'undeliv', 'reject', 'expire', 'block', 'ndnd', 'ndnc'].some((w) => s.includes(w))
  )
    return 'failed';
  if (s === '1' || s.includes('deliv')) return 'delivered';
  if (s.includes('sent')) return 'sent';
  return null;
}

export interface ParsedReport {
  provider: 'twilio' | 'msg91';
  messageId: string;
  status: ReportStatus;
  errorCode: string | null;
  errorMessage: string | null;
}

type Dict = Record<string, unknown>;
const isDict = (x: unknown): x is Dict => typeof x === 'object' && x !== null && !Array.isArray(x);
const text = (x: unknown): string =>
  typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '';

/** Twilio's form callback: `MessageSid` (else `SmsSid`), `MessageStatus` (else `SmsStatus`), `ErrorCode`. Null when it names nothing we act on. */
export function parseTwilioReport(body: unknown): ParsedReport | null {
  if (!isDict(body)) return null;
  const messageId = text(body.MessageSid) || text(body.SmsSid);
  const raw = text(body.MessageStatus) || text(body.SmsStatus);
  if (!messageId || !raw) return null;
  const status = mapProviderStatus(raw);
  if (!status) return null;
  return {
    provider: 'twilio',
    messageId,
    status,
    errorCode: text(body.ErrorCode) || null,
    errorMessage: text(body.ErrorMessage) || null,
  };
}

/**
 * MSG91's delivery report: the payload may be wrapped in `data`; the id is `requestId` or `request_id`; the status `status` or
 * `deliveryStatus`; or a nested `report` that is a string (the status) or a list whose first entry holds `status`,
 * `deliveryStatus` or `desc` (and the id when there is none at the top).
 */
export function parseMsg91Report(body: unknown): ParsedReport | null {
  if (!isDict(body)) return null;
  const p: Dict = isDict(body.data) ? body.data : body;
  let messageId = text(p.requestId) || text(p.request_id);
  let raw = text(p.status) || text(p.deliveryStatus);
  const report = p.report;
  if (typeof report === 'string') raw = raw || report.trim();
  else if (Array.isArray(report) && isDict(report[0])) {
    const first = report[0];
    raw = raw || text(first.status) || text(first.deliveryStatus) || text(first.desc);
    messageId = messageId || text(first.requestId) || text(first.request_id);
  }
  if (!messageId || !raw) return null;
  const status = mapProviderStatus(raw);
  if (!status) return null;
  return { provider: 'msg91', messageId, status, errorCode: null, errorMessage: null };
}
