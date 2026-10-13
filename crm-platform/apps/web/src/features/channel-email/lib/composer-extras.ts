import { emailReplyExtrasSchema, type EmailReplyExtras } from '@crm/contracts';

export interface ExtrasDraft {
  cc: string;
  bcc: string;
  subject: string;
}

export const EMPTY_EXTRAS: ExtrasDraft = { cc: '', bcc: '', subject: '' };

/** Splits what was typed on commas, semicolons and spaces; keeps the first of a repeated address. */
export function splitAddresses(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    // `Name <a@b.c>` pasted from a mail client: take the part inside the brackets.
    const v = raw.replace(/^<|>$/g, '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

const SHAPE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export const invalidAddresses = (list: readonly string[]): string[] =>
  list.filter((a) => !SHAPE.test(a));

export type ExtrasProblem =
  'ccInvalid' | 'bccInvalid' | 'ccTooMany' | 'bccTooMany' | 'subjectTooLong';

export interface ExtrasResult {
  /** What the send carries; undefined when nothing was added. */
  extras: EmailReplyExtras | undefined;
  problems: Partial<Record<'cc' | 'bcc' | 'subject', ExtrasProblem>>;
  /** The addresses that did not look like one, to name them under the field. */
  invalid: { cc: string[]; bcc: string[] };
}

/** Turns the three optional composer fields into the `email` extras of a send, or the reason they cannot be sent. */
export function buildExtras(d: ExtrasDraft): ExtrasResult {
  const cc = splitAddresses(d.cc);
  const bcc = splitAddresses(d.bcc);
  const subject = d.subject.trim();
  const problems: ExtrasResult['problems'] = {};
  const invalid = { cc: invalidAddresses(cc), bcc: invalidAddresses(bcc) };
  if (invalid.cc.length > 0) problems.cc = 'ccInvalid';
  else if (cc.length > 20) problems.cc = 'ccTooMany';
  if (invalid.bcc.length > 0) problems.bcc = 'bccInvalid';
  else if (bcc.length > 20) problems.bcc = 'bccTooMany';
  if (subject.length > 998) problems.subject = 'subjectTooLong';
  if (Object.keys(problems).length > 0) return { extras: undefined, problems, invalid };
  if (cc.length === 0 && bcc.length === 0 && subject === '') {
    return { extras: undefined, problems, invalid };
  }
  const parsed = emailReplyExtrasSchema.safeParse({
    cc,
    bcc,
    ...(subject ? { subject } : {}),
  });
  return parsed.success
    ? { extras: parsed.data, problems, invalid }
    : { extras: undefined, problems: { cc: 'ccInvalid' }, invalid };
}

/** `Re: <subject>` unless it already starts that way: what a reply is titled when the agent does not change it. */
export function defaultReplySubject(subject: string | null | undefined): string {
  const s = (subject ?? '').trim();
  if (!s) return '';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Longest email reply body the API takes (a text reply on other channels stops at 4096). */
export const EMAIL_BODY_MAX = 100_000;

/** The subject of the newest email in a thread (messages ascending), or the conversation title when none carries one. */
export function latestEmailSubject(
  messages: ReadonlyArray<{ email?: { subject: string } | null }>,
  fallback: string | null | undefined,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const s = messages[i]?.email?.subject?.trim();
    if (s) return s;
  }
  return fallback ?? '';
}
