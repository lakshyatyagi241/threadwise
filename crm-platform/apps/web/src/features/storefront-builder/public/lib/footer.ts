import type { PublicShop } from '@crm/contracts';
import { sanitizeHtml, stripTags } from './sanitize';

/**
 * The API always sends a footer text: the merchant's, or "© <year> <shop>" when none was set. The footer's blurb column shows the
 * merchant's text, or a default sentence when there is none, so the default copyright line has to be told apart.
 */
export function isDefaultFooter(shop: Pick<PublicShop, 'footerText' | 'name'>): boolean {
  const text = stripTags(shop.footerText);
  return (
    text === '' ||
    new RegExp(`^©\\s*\\d{4}\\s+${shop.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(text)
  );
}

export function footerParts(shop: Pick<PublicShop, 'footerText' | 'name'>): {
  /** The merchant's own footer text as safe HTML, or null when only the default line exists. */
  custom: string | null;
  /** The bottom line as safe HTML, or null when the page should print its own copyright line. */
  bottom: string | null;
} {
  const html = sanitizeHtml(shop.footerText, 'inline');
  return { custom: isDefaultFooter(shop) ? null : html, bottom: html || null };
}
