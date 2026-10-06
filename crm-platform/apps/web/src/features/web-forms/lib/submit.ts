import type { PublicFormSubmitInput } from '@crm/contracts';
import { answersForSubmit } from './validate';
import { CONSENT_KEY, type Answers, type FieldIssue, type FormShape } from './types';

/** The body of `POST /v2/public/forms/:publicKey/submit` (spec section 7.2): the contract's own type, so a change there stops here. */
export type SubmitPayload = PublicFormSubmitInput;

export type SubmitNext = { type: 'message'; message: string } | { type: 'redirect'; url: string };

/** What the page does with the API's answer. The visitor is only ever told what their own input and the door's rules allow. */
export type SubmitOutcome =
  | { ok: true; next: SubmitNext }
  | { ok: false; kind: 'validation'; issues: FieldIssue[] }
  | { ok: false; kind: 'rate_limited'; retryAfterSeconds: number | null }
  | { ok: false; kind: 'closed' }
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
  return {
    idempotencyKey: ctx.idempotencyKey,
    answers: answersForSubmit(def, answers),
    hidden: hiddenValues(ctx.page),
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
