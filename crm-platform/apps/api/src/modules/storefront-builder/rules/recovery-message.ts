import { formatProductMoney } from '@crm/contracts';

/**
 * The abandoned-cart nudge (WD-STORE-015): the merchant's text, or "Hi <first name or 'there'>! You left some items in your
 * cart at <shop>. Complete your order here: <url>", with `{name}`, `{shop}`, `{url}` and `{total}` replaced. The total is
 * formatted in the shop currency.
 */
export function buildRecoveryMessage(input: {
  customText: string | null | undefined;
  customerName: string | null | undefined;
  shopName: string;
  shopUrl: string;
  subtotalMinor: number;
  currencyCode: string;
}): string {
  const firstName = (input.customerName ?? '').trim() || 'there';
  const base =
    (input.customText ?? '') ||
    `Hi ${firstName}! You left some items in your cart at ${input.shopName}. Complete your order here: ${input.shopUrl}`;
  const tokens: Record<string, string> = {
    '{name}': firstName,
    '{shop}': input.shopName,
    '{url}': input.shopUrl,
    '{total}': formatProductMoney(input.subtotalMinor, input.currencyCode || 'INR'),
  };
  // One pass, like PHP strtr: a replaced value is never scanned again.
  return base.replace(/\{name\}|\{shop\}|\{url\}|\{total\}/g, (t) => tokens[t] ?? t);
}

/** Delay before the nudge, in minutes: the shop's setting, at least 5, 30 when it was never set. */
export function recoveryDelayMinutes(configured: number | null | undefined): number {
  const n = Math.trunc(Number(configured ?? 30));
  return Math.max(5, Number.isFinite(n) ? n : 0);
}

/** The link in the nudge: `https://<verified custom domain>` else `<web app>/s/<slug>` (subdomain mode is ignored, as in WaDesk). */
export function recoveryShopUrl(
  shop: { slug: string; customDomain: string | null; customDomainVerified: boolean },
  webAppUrl: string,
): string {
  return shop.customDomainVerified && shop.customDomain
    ? `https://${shop.customDomain}`
    : `${webAppUrl}/s/${shop.slug}`;
}
