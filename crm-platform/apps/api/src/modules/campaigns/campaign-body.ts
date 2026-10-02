import type { TemplateOverrides, TemplateRecord } from '../broadcasts';

/** What one variant of a campaign sends (WD-CAMP-006, 007). Pure. */

export interface VariantContent {
  /** The approved template for a template campaign; null for a custom message. */
  template: TemplateRecord | null;
  /** The body before merge: the template's or the typed message. */
  text: string;
  /** Slot to attribute: the template's own map, or the composer's flat `{"1":"first_name"}`. */
  variableMap: unknown;
  header: string | null;
  footer: string | null;
  buttons: unknown[];
  quickReplies: unknown[];
  media: { kind: 'image' | 'video' | 'document'; url: string } | null;
  overrides: TemplateOverrides | null;
}

export interface Bundles {
  a: VariantContent;
  b: VariantContent;
}

/** Variant B only when A/B is on and the recipient was assigned B; every other row sends A. */
export const pickVariant = (
  bundles: Bundles,
  abTesting: boolean,
  variant: string | null,
): VariantContent => (abTesting && variant === 'B' ? bundles.b : bundles.a);

/**
 * The template's variable names differ between two templates, so variant B uses A's send-time overrides only when it sends the same
 * template; a different template gets its own, and without them it sends none (blank beats wrong).
 */
export function overridesForVariant(opts: {
  useB: boolean;
  aTemplateId: number | null;
  bTemplateId: number | null;
  overridesA: TemplateOverrides | null;
  overridesB: TemplateOverrides | null;
}): TemplateOverrides | null {
  if (!opts.useB) return opts.overridesA;
  const same = opts.aTemplateId !== null && opts.aTemplateId === opts.bTemplateId;
  return same ? opts.overridesA : opts.overridesB;
}

/** The merge pass that also runs on a template body: the recipient's name falls back to "there" so a message never reads "Hi ,". */
export const tidy = (s: string): string =>
  s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/gu, '$1')
    .replace(/([,;:])\s*([,.!?;:])/gu, '$2')
    .trim();

/** Header (when the body does not begin with it) and body as one text, the way the inbox bubble reads. */
export const withHeader = (header: string | null, body: string): string => {
  const h = (header ?? '').trim();
  return h !== '' && body !== '' && !body.startsWith(h) ? `${h}\n\n${body}` : body;
};
