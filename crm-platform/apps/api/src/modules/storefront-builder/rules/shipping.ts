/** `wa_storefronts.shipping_json`: minor units, a key is absent when it is zero or blank. */
export interface ShippingConfig {
  flat_minor?: number;
  free_above_minor?: number;
  note?: string;
}

/**
 * The shipping fee for a cart subtotal (WaDesk `shippingFee`): zero when nothing is configured or the subtotal reaches the
 * free-above amount, else the flat fee. Always computed on the subtotal BEFORE any coupon.
 */
export function shippingFee(cfg: ShippingConfig | null | undefined, subtotalMinor: number): number {
  if (!cfg) return 0;
  const freeAbove = Number(cfg.free_above_minor ?? 0);
  if (freeAbove > 0 && subtotalMinor >= freeAbove) return 0;
  return Number(cfg.flat_minor ?? 0);
}

/** Major units typed in the settings form to minor units: times 100, rounded half away from zero as PHP `round` does. */
export const majorToMinor = (major: string | number): number => Math.round(Number(major) * 100);

/**
 * The value saved from the three shipping inputs. A blank or zero amount is dropped, the note is kept when it is not empty,
 * and the whole value is null when nothing is left ("no shipping").
 */
export function buildShippingJson(input: {
  flat?: string | null;
  freeAbove?: string | null;
  note?: string | null;
}): ShippingConfig | null {
  const out: ShippingConfig = {};
  const flat = input.flat ? majorToMinor(input.flat) : 0;
  const freeAbove = input.freeAbove ? majorToMinor(input.freeAbove) : 0;
  if (flat > 0) out.flat_minor = flat;
  if (freeAbove > 0) out.free_above_minor = freeAbove;
  if (input.note) out.note = input.note;
  return Object.keys(out).length > 0 ? out : null;
}

/** Minor units as the plain decimal string the settings form shows: "49.5" is shown as "49.50", a whole amount as "100". */
export function minorToMajorString(minor: number | undefined): string | null {
  if (!minor) return null;
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}
