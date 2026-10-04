import { cleanVar } from './clean-var';

/**
 * How the commerce node group's builder nodes become executor props (WD-FLR-026, 040, 041, 043). Kept beside `compileGraph` but in
 * its own file so the group's shapes are one place; `compileGraph` calls `shapeCommerceNode` first and falls through when it answers
 * null. Pure.
 */

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? fallback : String(v);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const int = (v: unknown, fallback: number): number => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : fallback;
};

/** One product the shop node offers, as the builder snapshot saved it. */
export interface ShopProduct {
  retailerId: string;
  name: string;
  image: string;
  priceMinor: number;
  currency: string;
  url: string;
}

/** Products saved as `productItems`, as the older `productIds[]` (a list of retailer ids) or `product` (one id), at most 30. */
export function shopProductsOf(data: Record<string, unknown>): ShopProduct[] {
  let picked = arr(data.productItems);
  if (picked.length === 0 && Array.isArray(data.productIds)) {
    picked = data.productIds.map((id) => ({ retailer_id: str(id) }));
  }
  if (picked.length === 0 && str(data.product) !== '')
    picked = [{ retailer_id: str(data.product) }];
  return picked
    .map((raw) => {
      const p = obj(raw);
      return {
        retailerId: str(p.retailer_id ?? p.retailerId),
        name: str(p.name),
        image: str(p.image),
        priceMinor: int(p.price_minor ?? p.priceMinor, 0),
        currency: str(p.currency),
        url: str(p.url),
      };
    })
    .filter((p) => p.retailerId !== '')
    .slice(0, 30);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOf = (v: unknown): string =>
  typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : '';

export function shapeCommerceNode(
  type: string,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (type) {
    case 'template':
      return {
        templateName: str(data.tpl ?? data.templateName).trim(),
        templateId: int(data.tplId ?? data.templateId, 0),
        // The editor saves the template's uuid; the node resolves it to the row (flow-refs.ts). An integer id keeps `templateId`.
        ...(uuidOf(data.tplId ?? data.templateId)
          ? { templateUuid: uuidOf(data.tplId ?? data.templateId) }
          : {}),
        preview: str(data.preview),
        keepMenuOpen: data.keepMenuOpen !== false,
      };
    case 'wa_form':
      return {
        formId: str(data.formId).trim(),
        bodyText: str(data.bodyText, 'Please tap below to fill out our form.'),
        ctaLabel: str(data.ctaLabel, 'Open form'),
        flowVariable: cleanVar(data.flowVariable, 'form_submission'),
      };
    case 'book_appointment':
      return {
        slotCount: int(data.slotCount, 5),
        prompt: str(data.prompt, 'Pick a time that works for you:'),
        confirmation: str(data.confirmation, '✅ Booked! See you on {{slot}}.'),
        calendarOverride: str(data.calendarOverride),
        collectEmail: data.collectEmail === true,
        bookingTypeId: str(data.bookingTypeId ?? ''),
      };
    case 'whatsapp_shop':
    case 'woocommerce':
    case 'shopify':
      return {
        provider: type,
        storeId: str(data.storeId),
        headerText: str(data.headerText),
        bodyText: str(data.bodyText, 'Tap a product to see details:'),
        footerText: str(data.footerText),
        abandonedWaitMinutes: int(data.abandonedWaitMinutes, 5),
        products: shopProductsOf(data),
      };
    default:
      return null;
  }
}
