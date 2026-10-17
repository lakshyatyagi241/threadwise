/**
 * Where checkout sends the buyer after an instant payment: the app page the Marketplace asked for (`?return=/marketplace/app/<slug>`),
 * or null. Only a Marketplace app page is accepted (a same-site path, one segment after /marketplace/app/), so an address in a link can
 * never send the buyer anywhere else.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  const p = raw?.trim();
  return p && /^\/marketplace\/app\/[A-Za-z0-9._~%-]{1,100}$/.test(p) ? p : null;
}

/** The order history page of an outcome, or the app page that asked for the checkout when there is one. */
export function afterPaymentPath(
  outcome: 'success' | 'proof',
  order: string,
  returnTo: string | null,
): string {
  const q = `payment=${outcome}&order=${encodeURIComponent(order)}`;
  return `${returnTo ?? '/billing/orders'}?${q}`;
}
