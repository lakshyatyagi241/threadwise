import type { StorefrontSettings } from '@crm/contracts';

/** What the settings form submits for `settings_json` (blank text arrives as null, absent or an empty string). */
export interface SettingsInput {
  logoUrl?: string | null;
  brandColor?: string | null;
  heroText?: string | null;
  footerText?: string | null;
  cartRecoveryEnabled: boolean;
  cartRecoveryDelayMin?: number | null;
  cartRecoveryMessage?: string | null;
}

const OPTIONAL_KEYS = [
  ['logo_url', 'logoUrl'],
  ['brand_color', 'brandColor'],
  ['hero_text', 'heroText'],
  ['footer_text', 'footerText'],
] as const;

/**
 * The new `settings_json`. Blank logo, colour, hero and footer are removed, the three recovery keys are always written (enabled
 * false, delay 30 and message null by default). Reference rebuilt the object from these keys only and so erased any other key
 * (the themes read `top_strip` and `hero_sub`, which no screen writes); here every other key is kept.
 */
export function buildSettings(
  existing: Record<string, unknown>,
  input: SettingsInput,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, field] of OPTIONAL_KEYS) {
    const v = input[field];
    if (v) out[key] = v;
    else delete out[key];
  }
  out.cart_recovery_enabled = input.cartRecoveryEnabled === true;
  out.cart_recovery_delay_min = Math.trunc(input.cartRecoveryDelayMin ?? 30);
  out.cart_recovery_message = (input.cartRecoveryMessage ?? '').trim() || null;
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `settings_json` as the settings page and the dashboard read it. Recovery counts only when it is exactly `true`. */
export function readSettings(settings: Record<string, unknown>): StorefrontSettings {
  const delay = Number(settings.cart_recovery_delay_min);
  return {
    logoUrl: str(settings.logo_url),
    brandColor: str(settings.brand_color),
    heroText: str(settings.hero_text),
    footerText: str(settings.footer_text),
    cartRecoveryEnabled: settings.cart_recovery_enabled === true,
    cartRecoveryDelayMin: Number.isFinite(delay) && delay > 0 ? Math.trunc(delay) : 30,
    cartRecoveryMessage: str(settings.cart_recovery_message),
  };
}
