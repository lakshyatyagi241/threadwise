export type RtoBand = 'low' | 'medium' | 'high';

/** What the workspace knows about the buyer's phone, counted over every channel and compared as digits. */
export interface PhoneHistory {
  priorCount: number;
  priorCancelled: number;
  /** Orders in status `shipped` or `paid`: WaDesk's approximation of "delivered". */
  priorDelivered: number;
}

export interface RtoResult {
  score: number;
  band: RtoBand;
  reasons: string[];
}

/**
 * Return-to-origin risk of a cash-on-delivery order, 0..100 (WaDesk `StorefrontRiskService`, WD-STORE-019). Pure: the caller
 * supplies the history of the phone and the workspace's average order total (minor units, 0 when there is none).
 *
 *   first-time buyer +30, else no fulfilled order +18; cancelled orders +15 each capped at +30, else two or more fulfilled -15
 *   (floor 0); total above 2x the average +25, above 1.5x +12; phone shorter than 8 digits +15.
 */
export function scoreRto(input: {
  phoneDigits: string;
  totalMinor: number;
  history: PhoneHistory;
  averageTotalMinor: number;
}): RtoResult {
  const { phoneDigits, totalMinor, history, averageTotalMinor } = input;
  const reasons: string[] = [];
  let score = 0;

  if (history.priorCount === 0) {
    score += 30;
    reasons.push('First-time buyer (no order history)');
  } else if (history.priorDelivered === 0) {
    score += 18;
    reasons.push('No previously fulfilled order');
  }

  if (history.priorCancelled > 0) {
    score += Math.min(30, history.priorCancelled * 15);
    reasons.push(
      `${history.priorCancelled} prior cancelled order${history.priorCancelled === 1 ? '' : 's'}`,
    );
  } else if (history.priorDelivered >= 2) {
    score = Math.max(0, score - 15);
    reasons.push('Repeat customer with fulfilled orders');
  }

  if (averageTotalMinor > 0 && totalMinor > averageTotalMinor * 2) {
    score += 25;
    reasons.push('Order value 2x+ the store average');
  } else if (averageTotalMinor > 0 && totalMinor > averageTotalMinor * 1.5) {
    score += 12;
    reasons.push('Order value above average');
  }

  if (phoneDigits.length < 8) {
    score += 15;
    reasons.push('Short / suspicious phone number');
  }

  score = Math.max(0, Math.min(100, score));
  const band: RtoBand = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, band, reasons };
}
