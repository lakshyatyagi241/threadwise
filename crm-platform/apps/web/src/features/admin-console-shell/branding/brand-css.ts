import { isLightColor, type WorkspaceBrand } from '@crm/contracts';

const HEX = /^#[0-9a-fA-F]{6}$/;
const ok = (v: string | null | undefined): v is string => typeof v === 'string' && HEX.test(v);
const onColour = (hex: string) => (isLightColor(hex) ? '#0b1f1c' : '#ffffff');

/**
 * The workspace's colours as CSS custom properties (WD-ASHELL-025). Variables, not rewritten utility classes (WaDesk forced six
 * classes with `!important`). Only `#RRGGBB` values are ever written, so nothing else can reach the style rule. The page
 * background applies to the light theme only: a light custom background under the dark theme's light text would be unreadable.
 * Returns an empty string when the owner set no colour.
 */
export function brandCss(
  brand: Pick<WorkspaceBrand, 'primary' | 'accent' | 'background'> | null,
): string {
  if (!brand) return '';
  const all: string[] = [];
  if (ok(brand.primary)) {
    all.push(
      `--primary:${brand.primary}`,
      `--primary-foreground:${onColour(brand.primary)}`,
      `--brand:${brand.primary}`,
      `--brand-foreground:${onColour(brand.primary)}`,
      `--nav-ring:${brand.primary}`,
    );
  }
  if (ok(brand.accent)) all.push(`--nav-accent:${brand.accent}`);
  const rules: string[] = [];
  if (all.length) rules.push(`:root{${all.join(';')}}`);
  if (ok(brand.background)) {
    rules.push(`:root:not([data-theme='dark']){--background:${brand.background}}`);
  }
  return rules.join('');
}
