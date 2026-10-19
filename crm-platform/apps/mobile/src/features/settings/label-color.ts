import { processColor } from 'react-native';
import { DEFAULT_LABEL_COLOR } from '@/lib/theme/tokens';

const HEX = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NAMED = /^[a-zA-Z]{3,20}$/;

/**
 * A stored label colour that is safe to draw: a hex colour (with or without the `#`) or a plain colour name the phone knows. Anything
 * else (the server accepts any 1 to 16 letters, digits, dashes or underscores) falls back to the default instead of an invalid style.
 */
export function safeLabelColor(raw: string | null | undefined): string {
  const c = (raw ?? '').trim();
  if (HEX.test(c)) return c.startsWith('#') ? c : `#${c}`;
  if (NAMED.test(c) && processColor(c) !== null && processColor(c) !== undefined) return c;
  return DEFAULT_LABEL_COLOR;
}
