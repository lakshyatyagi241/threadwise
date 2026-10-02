import {
  BRANDING_FOOTER_MAX,
  footerLength,
  type PlatformBrandingFooterResponse,
} from '@crm/contracts';

export { BRANDING_FOOTER_MAX as FOOTER_MAX, footerLength };

/**
 * The first `max` characters of `value`, counted the way a person counts them: an emoji is one, not
 * the two units `maxLength` would charge. Never cuts a character in half.
 */
export function clampFooter(value: string, max: number = BRANDING_FOOTER_MAX): string {
  if (value.length <= max) return value;
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * The footer line as a recipient's WhatsApp shows it: the text between underscores (italics), or
 * the "no footer" label when it is blank. The text is wrapped as typed, spaces included.
 */
export function footerPreview(footer: string, noFooterLabel: string): string {
  return footer.trim() ? `_${footer.trim()}_` : noFooterLabel;
}

/** How many characters are left, never below zero. */
export const footerRemaining = (footer: string): number =>
  Math.max(0, BRANDING_FOOTER_MAX - footerLength(footer));

/**
 * The PATCH body for a draft, or null when nothing would change. The server trims, so a draft that
 * only differs in surrounding spaces is not a change. A blank footer is sent as '': no footer at all
 * (WaDesk sends nothing on a blank platform footer; it does not fall back to the built-in text).
 */
export function buildFooterPatch(
  saved: Pick<PlatformBrandingFooterResponse, 'footer'>,
  draft: string,
): { footer: string } | null {
  const next = draft.trim();
  return next === saved.footer.trim() ? null : { footer: next };
}
