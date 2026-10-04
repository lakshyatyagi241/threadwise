/** The links the shop builds in the browser: WhatsApp chats and the share dialog (WD-STORE-010, WD-STORE-026). */

const digits = (v: string): string => v.replace(/\D+/g, '');

/** `wa.me` chat with the shop's number, optionally with a prefilled text. */
export function waChatUrl(waNumber: string, text?: string): string {
  const base = `https://wa.me/${digits(waNumber)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** PHP's `urlencode` (spaces as `+`, every byte but letters, digits and `-_.` escaped), which WaDesk uses for this one link. */
const phpUrlencode = (v: string): string =>
  encodeURIComponent(v)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The product page's "Ask a question on WhatsApp". */
export function productQuestionUrl(
  waNumber: string,
  productName: string,
  productUrl: string,
): string {
  const text = `Hi! I have a question about: ${productName} (${productUrl})`;
  return `https://wa.me/${digits(waNumber)}?text=${phpUrlencode(text)}`;
}

/** The tracking page's "Message us about this order". */
export function orderQuestionUrl(waNumber: string, orderNo: number): string {
  return waChatUrl(waNumber, `Hi! About my order #${orderNo}`);
}

export interface ShareLinks {
  text: string;
  whatsapp: string;
  telegram: string;
  mailto: string;
}

export function shareLinks(url: string, title: string): ShareLinks {
  const text = `Check this out: ${title}\n${url}`;
  return {
    text,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
    mailto: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`,
  };
}

/** Only http(s) links are followed from data the merchant or a payment provider supplied. */
export function safeHttpUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The WhatsApp hand-off the checkout API returns must really be a wa.me link before the browser is sent there. */
export function isWaHandoff(v: string | null | undefined): v is string {
  const u = safeHttpUrl(v);
  if (!u) return false;
  const host = new URL(u).hostname;
  return host === 'wa.me' || host === 'api.whatsapp.com' || host.endsWith('.whatsapp.com');
}

/** The product page path of a product inside a shop, relative to the site root. */
export const productPath = (shopSlug: string, productSlug: string): string =>
  `/s/${encodeURIComponent(shopSlug)}/p/${encodeURIComponent(productSlug)}`;

export const shopPath = (shopSlug: string): string => `/s/${encodeURIComponent(shopSlug)}`;
