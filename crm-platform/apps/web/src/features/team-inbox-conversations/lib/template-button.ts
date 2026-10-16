import type { MessageTemplateButton } from '@crm/contracts';
import { safeHttpHref, telHref } from '@/lib/safe-links';

/**
 * The link a template button opens, or null when it has none to open. A URL button opens its web address (see `safeHttpHref`);
 * a call button dials its number (see `telHref`). Everything else is drawn without a link.
 */
export function templateButtonHref(
  b: Pick<MessageTemplateButton, 'type' | 'url' | 'phone'>,
): string | null {
  if (b.type === 'url') return safeHttpHref(b.url);
  if (b.type === 'phone') return telHref(b.phone);
  return null;
}
