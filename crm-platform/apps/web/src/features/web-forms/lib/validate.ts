import {
  CONSENT_KEY,
  type AnswerValue,
  type Answers,
  type FormShape,
  type FieldBlock,
  type FieldIssue,
} from './types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** A phone number as typed: digits with the usual separators, 7 to 15 digits (E.164's ceiling). The server canonicalises it. */
const PHONE_CHARS = /^\+?[\d\s().-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
/** Patterns are tested against at most this many characters, as on the server, so a long paste cannot stall the page. */
const PATTERN_TEST_LIMIT = 500;

export const isBlank = (v: AnswerValue | undefined): boolean =>
  v === undefined ||
  v === false ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

/** Strips NUL and control characters other than newline and tab, as the server does, so a pasted value cannot differ. */
export function cleanText(v: string): string {
  return v.replace(CONTROL, '');
}

function numberIssue(f: FieldBlock, s: string): FieldIssue | null {
  const n = Number(s);
  if (!Number.isFinite(n)) return { fieldId: f.id, code: 'invalid_number' };
  if (f.validation?.min !== undefined && n < f.validation.min)
    return { fieldId: f.id, code: 'too_small' };
  if (f.validation?.max !== undefined && n > f.validation.max)
    return { fieldId: f.id, code: 'too_large' };
  return null;
}

/** Why one field's value is not acceptable, or null. Mirrors the server's per-kind rules (spec section 9.1, step 4). */
export function fieldIssue(f: FieldBlock, value: AnswerValue | undefined): FieldIssue | null {
  if (f.kind === 'hidden') return null;
  if (isBlank(value)) return f.required ? { fieldId: f.id, code: 'required' } : null;
  const v = f.validation;
  switch (f.kind) {
    case 'checkbox':
      return null;
    case 'checkbox_group': {
      const list = Array.isArray(value) ? value : [];
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      return list.every((x) => allowed.has(x)) ? null : { fieldId: f.id, code: 'invalid_option' };
    }
    case 'dropdown':
    case 'radio': {
      const allowed = new Set((f.options ?? []).map((o) => o.value));
      return typeof value === 'string' && allowed.has(value)
        ? null
        : { fieldId: f.id, code: 'invalid_option' };
    }
    case 'email':
      return EMAIL.test(String(value).trim()) ? null : { fieldId: f.id, code: 'invalid_email' };
    case 'phone': {
      const s = String(value).trim();
      const digits = s.replace(/\D/g, '');
      return PHONE_CHARS.test(s) && digits.length >= 7 && digits.length <= 15
        ? null
        : { fieldId: f.id, code: 'invalid_phone' };
    }
    case 'number':
    case 'currency':
      return numberIssue(f, String(value).trim());
    case 'rating': {
      const n = Number(value);
      const min = v?.min ?? 1;
      const max = v?.max ?? 5;
      return Number.isInteger(n) && n >= min && n <= max
        ? null
        : { fieldId: f.id, code: 'invalid_number' };
    }
    case 'date': {
      const s = String(value);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
        ? null
        : { fieldId: f.id, code: 'invalid_date' };
    }
    case 'short_text':
    case 'long_text': {
      const s = String(value);
      if (v?.minLen !== undefined && s.trim().length < v.minLen)
        return { fieldId: f.id, code: 'too_short' };
      if (v?.maxLen !== undefined && s.length > v.maxLen)
        return { fieldId: f.id, code: 'too_long' };
      if (v?.pattern) {
        try {
          if (!new RegExp(v.pattern).test(s.slice(0, PATTERN_TEST_LIMIT)))
            return { fieldId: f.id, code: 'pattern' };
        } catch {
          // A pattern that is not a regular expression is refused at save, so this is only a guard.
        }
      }
      return null;
    }
  }
}

/** Every issue for the answers, in the form's order; the consent box comes last. `onlyStep` limits the check to one step. */
export function validateAnswers(def: FormShape, answers: Answers, onlyStep?: number): FieldIssue[] {
  const steps =
    onlyStep === undefined ? def.steps : [def.steps[onlyStep]].filter((s) => s !== undefined);
  const out: FieldIssue[] = [];
  for (const step of steps) {
    for (const b of step.blocks) {
      if (b.type !== 'field') continue;
      const issue = fieldIssue(b, answers[b.id]);
      if (issue) out.push(issue);
    }
  }
  const lastStep = onlyStep === undefined || onlyStep === def.steps.length - 1;
  if (lastStep && def.consent.enabled && def.consent.required && answers[CONSENT_KEY] !== true) {
    out.push({ fieldId: CONSENT_KEY, code: 'consent_required' });
  }
  return out;
}

/**
 * The answers as the API takes them: blank ones left out, text cleaned and trimmed, numbers sent as numbers. A hidden field is never
 * sent (its value is made by the page's tracking keys or the form's constant, on the server).
 */
export function answersForSubmit(
  def: FormShape,
  answers: Answers,
): Record<string, string | number | boolean | string[]> {
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const b of def.steps.flatMap((s) => s.blocks)) {
    if (b.type !== 'field' || b.kind === 'hidden') continue;
    const v = answers[b.id];
    if (v === undefined || isBlank(v)) continue;
    if (typeof v === 'string') {
      const text = cleanText(v).trim();
      if (b.kind === 'number' || b.kind === 'currency' || b.kind === 'rating')
        out[b.id] = Number(text);
      else out[b.id] = text;
    } else out[b.id] = v;
  }
  return out;
}
