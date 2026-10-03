import type { PublicProductPage, PublicProduct, PublicShop } from '@crm/contracts';
import type { Metadata } from 'next';
import { stripTags } from './sanitize';

/**
 * Titles, descriptions, Open Graph and JSON-LD of the public pages (WD-STORE-027).
 *
 * A shop page is its own site: the staff app's title template ("... - <platform>"), its default `robots` and its Open Graph block
 * must not leak onto it, so the title is `absolute` and the inherited fields are reset with `null`.
 */

/** Cuts text at `max` characters and marks the cut. */
export function limit(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t;
}

const shopDescription = (shop: PublicShop) =>
  limit(stripTags(shop.heroText) || `${shop.name} on WhatsApp`, 160);

export function homeMetadata(shop: PublicShop, url: string): Metadata {
  const image = shop.logoUrl ?? undefined;
  return {
    title: { absolute: shop.name },
    description: shopDescription(shop),
    robots: null,
    openGraph: {
      type: 'website',
      siteName: shop.name,
      title: shop.name,
      description: limit(stripTags(shop.heroText) || `${shop.name} on WhatsApp`, 200),
      url,
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary' },
  };
}

/** `og:type` is `product` on a product page, which Next's typed `openGraph.type` does not offer: the page emits that one tag itself. */
export function productMetadata(shop: PublicShop, product: PublicProduct, url: string): Metadata {
  const image = product.imageUrl ?? undefined;
  const source = stripTags(product.description) || shop.name;
  return {
    title: { absolute: `${product.name} · ${shop.name}` },
    description: limit(source, 160),
    robots: null,
    openGraph: {
      siteName: shop.name,
      title: product.name,
      description: limit(source, 200),
      url,
      ...(image ? { images: [image] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary' },
  };
}

export function orderMetadata(shop: PublicShop, orderNo: number): Metadata {
  return {
    title: { absolute: `Order #${orderNo} · ${shop.name}` },
    description: null,
    robots: { index: false },
    openGraph: null,
    twitter: null,
  };
}

const present = (v: unknown): boolean =>
  v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

/** schema.org Product, with null and empty keys removed. */
export function productJsonLd(page: PublicProductPage, url: string): Record<string, unknown> {
  const { product, shop } = page;
  const soldOut = product.stockQty !== null && product.stockQty <= 0;
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: product.imageUrl ? [product.imageUrl] : [],
    description: limit(stripTags(product.description), 500),
    sku: product.sku,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : null,
    offers: {
      '@type': 'Offer',
      price: (product.priceMinor / 100).toFixed(2),
      priceCurrency: product.currencyCode || shop.currencyCode || 'INR',
      availability: soldOut ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
      url,
    },
    aggregateRating:
      page.ratingCount > 0 && page.ratingAvg !== null
        ? { '@type': 'AggregateRating', ratingValue: page.ratingAvg, reviewCount: page.ratingCount }
        : null,
  };
  return Object.fromEntries(Object.entries(ld).filter(([, v]) => present(v)));
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so no value can close the tag. */
export const jsonLdString = (ld: Record<string, unknown>): string =>
  JSON.stringify(ld).replace(/</g, '\\u003c');
