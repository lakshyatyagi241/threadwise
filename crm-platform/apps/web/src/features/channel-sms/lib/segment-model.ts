import { measureSms, type SmsMeasure } from '@crm/contracts';

/** What a composer shows under an SMS text: the shared measure plus which warning applies. */
export interface SegmentView extends SmsMeasure {
  warning: 'none' | 'ucs2' | 'gsm';
}

/**
 * `measureSms` is the one implementation the API bills with. The warning wording lives in the messages (the contract's
 * `smsWarning` is English only), but follows its rule: nothing for a one-segment text, else the UCS-2 or the GSM-7 sentence.
 */
export function describeSegments(text: string): SegmentView {
  const m = measureSms(text);
  return { ...m, warning: m.segments <= 1 ? 'none' : m.encoding === 'UCS-2' ? 'ucs2' : 'gsm' };
}
