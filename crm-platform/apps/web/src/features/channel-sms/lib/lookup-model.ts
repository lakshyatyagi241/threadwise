import type { SmsLookupResponse } from '@crm/contracts';

/** The colour of the result line (TW-SMS-008): green when textable, coral for a number that would be charged and lost. */
export type LookupTone = 'good' | 'bad' | 'warn' | 'neutral';

export function lookupTone(kind: SmsLookupResponse['kind']): LookupTone {
  switch (kind) {
    case 'mobile':
      return 'good';
    case 'landline':
    case 'invalid':
      return 'bad';
    case 'voip':
      return 'warn';
    default:
      return 'neutral';
  }
}

/** An empty field runs nothing and clears the line, as in Reference. */
export const canLookup = (input: string): boolean => input.trim() !== '';

/** The kinds that have a sentence of their own in the messages; `unknown` shows the server's sentence. */
export const KNOWN_KINDS = ['mobile', 'landline', 'voip', 'invalid'] as const;
export const isKnownKind = (k: SmsLookupResponse['kind']): k is (typeof KNOWN_KINDS)[number] =>
  (KNOWN_KINDS as readonly string[]).includes(k);
