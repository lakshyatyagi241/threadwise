import {
  STORE_BRAND_DEFAULT,
  formatProductMoney,
  type PublicProduct,
  type PublicShop,
} from '@crm/contracts';
import type { StorefrontProduct } from '../../catalog-products';
import { sanitizeProductBody, sanitizeShopCopy } from '../rules/html';
import type { ShopRow } from '../shops/shops.repository';

/** The card's "New" badge: created within the last 14 days (WaDesk `created_at > now()-14 days`). */
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function toPublicProduct(p: StorefrontProduct): PublicProduct {
  const onSale = p.comparePriceMinor !== null && p.comparePriceMinor > p.priceMinor;
  return {
    id: p.uuid,
    slug: p.slug,
    name: p.name,
    sku: p.sku,
    description: p.description,
    // The body is shown unescaped, so it is cleaned here whatever the catalogue stored.
    bodyHtml: sanitizeProductBody(p.bodyHtml),
    priceMinor: p.priceMinor,
    priceDisplay: formatProductMoney(p.priceMinor, p.currencyCode),
    comparePriceMinor: p.comparePriceMinor,
    comparePriceDisplay:
      p.comparePriceMinor === null ? null : formatProductMoney(p.comparePriceMinor, p.currencyCode),
    onSale,
    currencyCode: p.currencyCode,
    imageUrl: p.imageUrl,
    galleryUrls: p.galleryUrls,
    category: p.category,
    stockQty: p.stockQty,
    brand: p.brand,
    isNew: p.createdAt ? p.createdAt.getTime() > Date.now() - NEW_WINDOW_MS : false,
    weightGrams: p.weightGrams ?? null,
    tags: p.tags ?? [],
  };
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The block every theme page receives. The display name is the shop name, else the workspace name, else "Store"; the footer
 * defaults to "© <year> <name>"; hero and footer text are sanitised (decision D-05); a theme key the app does not know falls
 * back to Aurora; the handle is the static payment detail and is never a secret (Razorpay keys are not in it).
 */
export function toPublicShop(
  shop: ShopRow,
  extra: {
    orgName: string | null;
    waNumber: string | null;
    publicUrl: string;
    knownThemes: readonly string[];
  },
): PublicShop {
  const s = shop.settings;
  const name = shop.shopName || extra.orgName || 'Store';
  const isApi = shop.paymentProvider === 'razorpay_api';
  const handle = !isApi ? text((shop.paymentConfig ?? {}).handle) : null;
  return {
    name,
    slug: shop.slug,
    themeKey: extra.knownThemes.includes(shop.themeKey) ? shop.themeKey : 'aurora',
    brandColor: text(s.brand_color) ?? STORE_BRAND_DEFAULT,
    heroText: sanitizeShopCopy(text(s.hero_text) ?? ''),
    footerText: sanitizeShopCopy(text(s.footer_text) ?? `© ${new Date().getFullYear()} ${name}`),
    logoUrl: text(s.logo_url),
    currencyCode: shop.currencyCode || 'INR',
    waNumber: extra.waNumber,
    shipping: {
      flatMinor: Number(shop.shipping?.flat_minor ?? 0),
      freeAboveMinor: Number(shop.shipping?.free_above_minor ?? 0),
      note: shop.shipping?.note ?? null,
    },
    payment: { provider: shop.paymentProvider, handle },
    publicUrl: extra.publicUrl,
  };
}
