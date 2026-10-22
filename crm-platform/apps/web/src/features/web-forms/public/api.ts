import {
  publicFormSubmissionStatusSchema,
  publicFormSubmitResponseSchema,
  type PublicFormEventInput,
  type PublicFormSubmissionStatus,
} from '@crm/contracts';
import { toApiError } from '@/lib/api/errors';
import { AGE_CONFIRMED_KEY, CONSENT_KEY, type FieldIssue, type IssueCode } from '../lib/types';
import type { SubmitOutcome, SubmitPayload } from '../lib/submit';

/**
 * The visitor's calls go to this origin's relay (`/api/public/forms/*`), never straight to the API: the page and its frame are
 * same-origin, so the relay can refuse cross-site writes and the browser needs no CORS. See `app/api/public/forms/[...path]`.
 */
const BASE = '/api/public/forms';

const KNOWN: ReadonlySet<string> = new Set<IssueCode>([
  'required',
  'invalid_email',
  'invalid_phone',
  'invalid_number',
  'invalid_date',
  'too_small',
  'too_large',
  'too_short',
  'too_long',
  'pattern',
  'invalid_option',
  'invalid_amount',
  'consent_required',
  'guardian_required',
]);

/** The API names the rule that failed in each error's `message`; a rule this page has no wording for reads as a format error. */
export function issuesFromErrors(errors: Array<{ path: string; message: string }>): FieldIssue[] {
  const seen = new Set<string>();
  const out: FieldIssue[] = [];
  for (const e of errors) {
    // The details point at `answers.<fieldId>` or just `<fieldId>`; the consent box is reported as `consent`.
    const id = e.path.replace(/^answers\./, '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      fieldId: id === 'consent' ? CONSENT_KEY : id === 'age_confirmed' ? AGE_CONFIRMED_KEY : id,
      code: KNOWN.has(e.message) ? (e.message as IssueCode) : 'pattern',
    });
  }
  return out;
}

export async function submitForm(key: string, payload: SubmitPayload): Promise<SubmitOutcome> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(key)}/submit`, {
      signal: AbortSignal.timeout(30000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
    });
  } catch {
    return { ok: false, kind: 'error' };
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (res.ok) {
    const parsed = publicFormSubmitResponseSchema.safeParse(json);
    return parsed.success
      ? { ok: true, next: parsed.data.next }
      : { ok: true, next: { type: 'message', message: '' } };
  }
  const error = toApiError(
    res.status,
    json,
    res.headers.get('x-request-id'),
    res.headers.get('retry-after'),
  );
  if (error.code === 'FORMS_VALIDATION') {
    const issues = issuesFromErrors(error.fieldErrors);
    return issues.length > 0
      ? { ok: false, kind: 'validation', issues }
      : { ok: false, kind: 'error' };
  }
  if (res.status === 429) {
    const wait = Number(error.fieldErrors.find((e) => e.path === 'retryAfterSeconds')?.message);
    return {
      ok: false,
      kind: 'rate_limited',
      retryAfterSeconds: Number.isFinite(wait) ? wait : null,
    };
  }
  if (error.code === 'FORMS_PAYMENT_UNAVAILABLE') return { ok: false, kind: 'payment_unavailable' };
  if (error.code === 'FORMS_AGE_BLOCKED') return { ok: false, kind: 'age_blocked' };
  if (error.code === 'FORMS_GUARDIAN_REQUIRED') return { ok: false, kind: 'guardian_required' };
  if (res.status === 404) return { ok: false, kind: 'closed' };
  return { ok: false, kind: 'error' };
}

/** Analytics beacon: never carries personal data, never blocks the visitor, and a failure is not worth reporting. */
export function sendEvent(key: string, event: PublicFormEventInput): void {
  try {
    void fetch(`${BASE}/${encodeURIComponent(key)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* analytics only */
  }
}

/** Where a submission's payment stands, for the page the visitor returns to from the gateway. Null when the answer is not understood. */
export async function submissionStatus(
  key: string,
  token: string,
): Promise<PublicFormSubmissionStatus | 'missing' | null> {
  try {
    const res = await fetch(
      `${BASE}/${encodeURIComponent(key)}/submissions/${encodeURIComponent(token)}`,
      {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.status === 404) return 'missing';
    if (!res.ok) return null;
    const parsed = publicFormSubmissionStatusSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
