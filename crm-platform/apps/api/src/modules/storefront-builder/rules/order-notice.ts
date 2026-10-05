import { totalDisplay } from './shop-url';

/** Capitalises the first letter, as PHP `ucfirst`. */
const ucfirst = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The WhatsApp text the buyer gets when the operator changes an order's status and/or types a payment link (WaDesk `notifyBuyer`):
 * "Your order #<id> is now: <Status>" and "Here's your payment link for <total>:" with the link on the next line, joined by a blank
 * line. Null when there is nothing to say. (WaDesk translated it to the buyer's language; that is not ported, see the parity notes.)
 */
export function statusNotice(input: {
  orderNo: number;
  status: string;
  statusChanged: boolean;
  link: string | null;
  totalMinor: number;
  currencyCode: string;
}): string | null {
  const lines: string[] = [];
  if (input.statusChanged)
    lines.push(`Your order #${input.orderNo} is now: ${ucfirst(input.status)}`);
  const link = (input.link ?? '').trim();
  if (link) {
    lines.push(
      `Here's your payment link for ${totalDisplay(input.totalMinor, input.currencyCode)}:\n${link}`,
    );
  }
  const body = lines.join('\n\n').trim();
  return body === '' ? null : body;
}

/** The message of "send a payment link" (the operator pasted it) and of "generate a payment link" (we minted it). */
export function paymentLinkNotice(input: {
  customerName: string | null;
  totalMinor: number;
  currencyCode: string;
  link: string;
  generated: boolean;
}): string {
  const who = input.customerName?.trim() || 'there';
  const kind = input.generated ? 'secure payment link' : 'payment link';
  return `Hi ${who}, here's your ${kind} for *${totalDisplay(input.totalMinor, input.currencyCode)}*:\n\n${input.link}`;
}
