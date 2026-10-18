/**
 * Error text that is safe to keep in a table an operator reads (a failed-operation record, a dead outbox event).
 *
 * An exception message can carry what the failing call was holding: a bearer token in a provider's echo of the request, a signed URL,
 * an email address or phone number from the message being worked. Failure records outlive the job and are read by people, so the text
 * is scrubbed on the way in and cut to a fixed length. This is a net, not a license: callers still prefer a stable error code and
 * keep the text only as a hint.
 */

const MAX = 300;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Authorization headers and bearer/basic credentials.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  // key=value or key: value for names that hold secrets.
  [
    /\b((?:access|refresh|id|api|auth|verify)[_-]?(?:token|key)|token|secret|password|passwd|signature|sig|authorization|credentials?|client[_-]?secret)\b(["']?\s*[:=]\s*["']?)[^\s"'&,;]{3,}/gi,
    '$1$2[redacted]',
  ],
  // Query strings: signed URLs keep their path, lose their parameters.
  [/(https?:\/\/[^\s?"']+)\?[^\s"']*/gi, '$1?[redacted]'],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[jwt]'],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Phone numbers: a plus or 9 to 15 digits, optionally spaced or dashed.
  [/\+?\d[\d\s().-]{7,}\d/g, '[number]'],
  // Long opaque strings (hex or base64 keys, provider tokens).
  [/\b[A-Za-z0-9_+/=-]{32,}\b/g, '[opaque]'],
];

export function sanitizeErrorText(input: unknown, max: number = MAX): string {
  let text: string;
  if (input instanceof Error) text = `${input.name}: ${input.message}`;
  else if (typeof input === 'string') text = input;
  else if (input === null || input === undefined) text = '';
  else {
    try {
      text = JSON.stringify(input) ?? String(input);
    } catch {
      text = String(input);
    }
  }
  // Control characters and newlines would break one-line log and CSV use; a stack trace is dropped, never kept.
  text = text.split('\n')[0] ?? '';
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const [re, to] of PATTERNS) text = text.replace(re, to);
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
