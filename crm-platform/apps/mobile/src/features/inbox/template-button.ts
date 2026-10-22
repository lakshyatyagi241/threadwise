import type { MessageTemplateButton } from '@crm/contracts';

/**
 * The address a sent template's button opens, or null when it has none to open (the web app's `templateButtonHref`, same rules). A link
 * button opens its web address, only over http or https and never one with an unfilled `{{n}}` (that address is made at send time, so the
 * final one is not known here); a call button dials its number, only digits with an optional leading `+`. Everything else is drawn only.
 */
export function templateButtonHref(
  button: Pick<MessageTemplateButton, 'type' | 'url' | 'phone'>,
): string | null {
  if (button.type === 'url') return webHref(button.url);
  if (button.type === 'phone') return telHref(button.phone);
  return null;
}

function webHref(url: string | null | undefined): string | null {
  if (!url || /\{\{/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function telHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const number = phone.trim().replace(/[\s()-]/g, '');
  return /^\+?\d{4,20}$/.test(number) ? `tel:${number}` : null;
}
