/**
 * The only places a stored or sent value becomes a link. A web address opens only over http or https, so a `javascript:` or
 * `data:` address never becomes a link, and an address with an unfilled `{{n}}` is not one either (it is filled at send time, so the
 * final address is not known here). A phone number dials only digits with an optional leading `+`.
 */

/** The address to link, or null when it is missing, has a placeholder, or is not a web address. */
export function safeHttpHref(url: string | null | undefined): string | null {
  if (!url || /\{\{/.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

/** The `tel:` link for a number, or null when it is missing or is not a number. */
export function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const number = phone.trim().replace(/[\s()-]/g, '');
  return /^\+?\d{4,20}$/.test(number) ? `tel:${number}` : null;
}
