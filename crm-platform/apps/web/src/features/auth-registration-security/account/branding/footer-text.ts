import { BRANDING_FOOTER_MAX, footerLength } from '@crm/contracts';

/** The longest message footer, in characters as a person counts them (TW-AUTH-029). */
export const FOOTER_MAX = BRANDING_FOOTER_MAX;

/** Length in code points (the contract's `footerLength`): an emoji counts once, not twice. */
export const codePointLength = footerLength;

/** The first `max` code points of `value`; never cuts a character in half. */
export function clampCodePoints(value: string, max: number = FOOTER_MAX): string {
  if (value.length <= max) return value;
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

/**
 * What the preview and the read-only state show for a footer: WhatsApp italic
 * markers around the text, or the "(no footer)" label when it is blank. Reference
 * wraps the raw text, spaces included.
 */
export function footerPreview(footer: string | null | undefined, noFooterLabel: string): string {
  return footer && footer.trim() ? `_${footer}_` : noFooterLabel;
}
