/**
 * Ready-made notes and terms. The text itself lives in the messages (`sales-docs.templates.*`) so it is translated; this file
 * only lists which templates exist.
 */
export const NOTE_TEMPLATES = ['thanks', 'scope', 'followUp'] as const;
export const TERMS_TEMPLATES = ['net14', 'net30', 'deposit50', 'warranty'] as const;
export type NoteTemplate = (typeof NOTE_TEMPLATES)[number];
export type TermsTemplate = (typeof TERMS_TEMPLATES)[number];

/** Adds a template to what is already typed: after a blank line, never replacing the person's own words. */
export function appendTemplate(current: string, template: string, max: number): string {
  const base = current.trimEnd();
  const next = base ? `${base}\n\n${template}` : template;
  return next.length > max ? next.slice(0, max) : next;
}

/** The currencies offered in the builder (the workspace currency and the document's own are added when missing). */
export const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'INR',
  'AED',
  'SAR',
  'QAR',
  'KWD',
  'BHD',
  'OMR',
  'EGP',
  'JOD',
  'TRY',
  'PKR',
  'BDT',
  'NGN',
  'ZAR',
  'KES',
  'BRL',
  'MXN',
  'CAD',
  'AUD',
  'NZD',
  'JPY',
  'CNY',
  'SGD',
  'MYR',
  'IDR',
  'PHP',
  'THB',
  'VND',
  'KRW',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
] as const;

export function currencyChoices(current: string, workspace: string | null): string[] {
  const set = new Set<string>([...COMMON_CURRENCIES]);
  if (workspace) set.add(workspace.toUpperCase());
  set.add(current.toUpperCase());
  return [...set].sort((a, b) => a.localeCompare(b));
}
