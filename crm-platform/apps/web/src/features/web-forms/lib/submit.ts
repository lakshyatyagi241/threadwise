import type { PublicFormSubmitInput } from '@crm/contracts';
import { answersForSubmit } from './validate';
import {
  AGE_CONFIRMED_KEY,
  CONSENT_KEY,
  GUARDIAN_EMAIL_KEY,
  GUARDIAN_NAME_KEY,
  GUARDIAN_PHONE_KEY,
  pageAgeGate,
  type Answers,
  type FieldIssue,
  type FormShape,
} from './types';

/** The body of `POST /v2/public/forms/:publicKey/submit` (spec section 7.2): the contract's own type, so a change there stops here. */
export type SubmitPayload = PublicFormSubmitInput;

export type SubmitNext =
  | { type: 'message'; message: string }
  | { type: 'redirect'; url: string }
  /** The form takes payment: the visitor goes to the gateway's hosted page. */
  | { type: 'pay'; url: string; message?: string };

/** What the page does with the API's answer. The visitor is only ever told what their own input and the door's rules allow. */
export type SubmitOutcome =
  | { ok: true; next: SubmitNext }
  | { ok: false; kind: 'validation'; issues: FieldIssue[] }
  | { ok: false; kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { ok: false; kind: 'closed' }
  | { ok: false; kind: 'payment_unavailable' }
  /** The age check refused the submission (BL-217). The page says so neutrally and does not offer another try in this session. */
  | { ok: false; kind: 'age_blocked' }
  /** The age check wants a parent or guardian before it accepts (BL-217). */
  | { ok: false; kind: 'guardian_required' }
  | { ok: false; kind: 'error' };

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

/** The tracking values the page reads from the visitor's address and referrer, clipped to the contract's bounds. */
export function hiddenValues(page: {
  search: string;
  referrer: string;
  href: string;
}): NonNullable<PublicFormSubmitInput['hidden']> {
  const params = new URLSearchParams(page.search);
  const out: NonNullable<PublicFormSubmitInput['hidden']> = {};
  for (const k of KEYS) {
    const v = params.get(k)?.slice(0, 255);
    if (v) out[k] = v;
  }
  const referrer = page.referrer.slice(0, 500);
  if (referrer) out.referrer = referrer;
  // The page address without the fragment; the query stays, because it is where the tracking values came from.
  const pageUrl = (page.href.split('#')[0] ?? '').slice(0, 500);
  if (pageUrl) out.page_url = pageUrl;
  return out;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function buildPayload(
  def: FormShape,
  answers: Answers,
  ctx: {
    idempotencyKey: string;
    hp: string;
    startedAt: number;
    page: { search: string; referrer: string; href: string };
    captchaToken?: string;
  },
): SubmitPayload {
  const guardianName = text(answers[GUARDIAN_NAME_KEY]);
  const guardianEmail = text(answers[GUARDIAN_EMAIL_KEY]);
  const guardianPhone = text(answers[GUARDIAN_PHONE_KEY]);
  return {
    idempotencyKey: ctx.idempotencyKey,
    answers: answersForSubmit(def, answers),
    hidden: hiddenValues(ctx.page),
    ...(pageAgeGate(def)?.mode === 'declaration'
      ? { ageConfirmed: answers[AGE_CONFIRMED_KEY] === true }
      : {}),
    ...(guardianName
      ? {
          guardian: {
            name: guardianName,
            ...(guardianEmail ? { email: guardianEmail } : {}),
            ...(guardianPhone ? { phone: guardianPhone } : {}),
          },
        }
      : {}),
    ...(def.consent.enabled
      ? { consent: { given: answers[CONSENT_KEY] === true, textVersion: def.consent.version } }
      : {}),
    ...(ctx.captchaToken ? { captchaToken: ctx.captchaToken } : {}),
    ...(ctx.hp ? { hp: ctx.hp } : {}),
    elapsedMs: Math.max(0, Math.round(Date.now() - ctx.startedAt)),
  };
}

/** A key the page makes once per load; the same key twice is the same submission (the API's idempotency rule). */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
